/**
 * Story folding.
 *
 * The same news event reaches the queue from many outlets and languages - one
 * story arrived 21 times in three weeks, and repeats were a third of everything
 * discarded on review. Title-word overlap caught only 24% of them, so matching
 * is done by a language model, once per pipeline run.
 *
 * raw_articles.story_id holds the id of the story's first article; NULL means
 * "not matched yet" (older rows, or a run whose matching call failed - those are
 * retried on the next run). Each call sees one headline per story active in the
 * last few days plus the newly accepted articles, and answers per article: an
 * existing story, an earlier new article it duplicates, or a new story.
 *
 * A new article that joins a story already approved on review is taken out of
 * the queue (status 'discarded', fold_reason 'story_already_approved'). It is
 * deliberately NOT written to rejected_articles: that table feeds the public
 * rejection log, and this is housekeeping, not an editorial decision.
 */

import db from "./db";
import { getSettings } from "./settings";
import { getFoldProvider } from "./llm";
import { recordDecision } from "./decision-log";

/** New articles per matching call; the story list is sent alongside. */
const MAX_NEW_PER_CALL = 40;
/** Upper bound on story headlines per call, most recently active first. */
const MAX_STORIES_PER_CALL = 600;

export interface FoldAnswer {
  n: number;       // 1-based index into the new articles
  match: string;   // "S<k>", "N<j>" (an earlier new article), or "new"
}

/**
 * Turn the model's answers into a story id per new article. Pure, so it can be
 * checked without a database or an API call.
 *
 * - "S<k>"  -> that existing story
 * - "N<j>"  -> the story of new article j, only if j comes earlier (j < n);
 *              anything else could form a cycle and is treated as "new"
 * - "new", a missing answer, or anything unrecognised -> a story of its own
 */
export function resolveAssignments(
  newIds: number[],
  storyIds: number[],
  answers: FoldAnswer[],
): Map<number, number> {
  const byN = new Map<number, string>();
  for (const a of answers) if (Number.isInteger(a.n) && !byN.has(a.n)) byN.set(a.n, String(a.match ?? "").trim());

  const result = new Map<number, number>();
  newIds.forEach((id, i) => {
    const n = i + 1;
    const m = (byN.get(n) ?? "new").toUpperCase();
    let story = id;
    const s = /^S(\d+)$/.exec(m);
    const e = /^N(\d+)$/.exec(m);
    if (s) {
      const k = Number(s[1]);
      if (k >= 1 && k <= storyIds.length) story = storyIds[k - 1];
    } else if (e) {
      const j = Number(e[1]);
      if (j >= 1 && j < n) story = result.get(newIds[j - 1]) ?? id;
    }
    result.set(id, story);
  });
  return result;
}

/** Pick every flat {"n":..,"match":..} object out of a reply, tolerating fences or truncation. */
export function parseFoldReply(raw: string): FoldAnswer[] {
  const out: FoldAnswer[] = [];
  for (const m of raw.matchAll(/\{[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0]);
      if (o && Number.isInteger(Number(o.n)) && typeof o.match === "string") out.push({ n: Number(o.n), match: o.match });
    } catch { /* not a verdict object */ }
  }
  return out;
}

const SYSTEM = `You match newly arrived news articles to stories already in an editor's queue.

Two articles are the SAME story only when they report the same specific event, finding or announcement - for example several outlets covering the same newly discovered species, or the same study reported in Dutch and in English.

They are NOT the same story when they merely share a topic: two different studies about sleep are different stories. An analysis, explainer, feature or opinion piece ABOUT an event is also a different story from the report of the event itself.

When unsure, answer "new". A missed match costs the editor one extra card; a wrong match hides a story from them.`;

function headline(title: unknown, titleEn: unknown): string {
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  const e = String(titleEn ?? "").replace(/\s+/g, " ").trim();
  return e && e !== t ? `${t} [EN: ${e}]` : t;
}

export interface FoldSummary {
  matched: number;            // joined an existing story or an earlier new article
  newStories: number;
  filedUnderApproved: number; // taken out of the queue: story already approved
  calls: number;
  failed: boolean;
}

/**
 * Match every not-yet-matched article from the window to a story. Never throws:
 * folding is a convenience, and a failure must not break the pipeline run -
 * unmatched articles simply show as their own story and are retried next run.
 */
export async function foldNewArticles(log?: (line: string) => void, runId?: number): Promise<FoldSummary> {
  const summary: FoldSummary = { matched: 0, newStories: 0, filedUnderApproved: 0, calls: 0, failed: false };
  const settings = await getSettings();
  if (settings.fold_enabled !== "true") return summary;

  const days = Math.max(1, Math.min(30, parseInt(settings.fold_window_days) || 5));
  const cutoff = `-${days} days`;

  try {
    const provider = await getFoldProvider();

    while (true) {
      const fresh = await db.execute({
        sql: `SELECT r.id, r.url, r.title, r.preview_title_en, r.status, s.name AS source_name
              FROM raw_articles r JOIN sources s ON s.id = r.source_id
              WHERE r.story_id IS NULL AND r.fetched_at >= datetime('now', ?)
              ORDER BY r.id ASC LIMIT ${MAX_NEW_PER_CALL}`,
        args: [cutoff],
      });
      if (fresh.rows.length === 0) break;

      // One headline per story still active in the window: the story's first article.
      const stories = await db.execute({
        sql: `SELECT lead.id AS story_id, lead.title, lead.preview_title_en, MAX(m.fetched_at) AS last_seen
              FROM raw_articles m JOIN raw_articles lead ON lead.id = m.story_id
              WHERE m.story_id IS NOT NULL
              GROUP BY m.story_id
              HAVING MAX(m.fetched_at) >= datetime('now', ?)
              ORDER BY last_seen DESC LIMIT ${MAX_STORIES_PER_CALL}`,
        args: [cutoff],
      });

      const newIds = fresh.rows.map((r) => Number(r.id));
      const storyIds = stories.rows.map((r) => Number(r.story_id));

      let assignments: Map<number, number>;
      if (newIds.length === 1 && storyIds.length === 0) {
        assignments = new Map([[newIds[0], newIds[0]]]);   // nothing to compare against
      } else {
        const user = [
          storyIds.length
            ? "Existing stories (one headline each):\n" +
              stories.rows.map((r, i) => `S${i + 1}. ${headline(r.title, r.preview_title_en)}`).join("\n")
            : "Existing stories: none yet.",
          "New articles:\n" +
            fresh.rows.map((r, i) => `N${i + 1}. (${r.source_name}) ${headline(r.title, r.preview_title_en)}`).join("\n"),
          `For each new article answer with the existing story it belongs to (e.g. "S4"), an EARLIER new article it repeats (e.g. "N2" for N5), or "new".
Reply with JSON only, no other text: {"assignments":[{"n":1,"match":"S4"},{"n":2,"match":"new"}]}`,
        ].join("\n\n");

        summary.calls++;
        const raw = await provider.generate(user, SYSTEM, 4000, 0, { effort: "low" });
        const answers = parseFoldReply(raw);
        if (answers.length === 0) throw new Error("story matching returned no usable answers");
        assignments = resolveAssignments(newIds, storyIds, answers);
      }

      // Which of the stories involved already have an approved article?
      const involved = [...new Set(assignments.values())];
      const approved = new Set<number>();
      if (involved.length) {
        const res = await db.execute(
          `SELECT DISTINCT story_id FROM raw_articles WHERE status = 'approved' AND story_id IN (${involved.join(",")})`,
        );
        for (const r of res.rows) approved.add(Number(r.story_id));
      }

      for (const row of fresh.rows) {
        const id = Number(row.id);
        const story = assignments.get(id) ?? id;
        if (story === id) summary.newStories++; else summary.matched++;
        // Only matches are logged: "new story" is the default and changes nothing.
        const provenance = {
          url: String(row.url), stage: "fold", actor: "llm",
          provider: provider.name, model: provider.model, runId,
        } as const;
        if (story !== id && row.status === "pending" && approved.has(story)) {
          await db.execute({
            sql: `UPDATE raw_articles SET story_id = ?, status = 'discarded', fold_reason = 'story_already_approved'
                  WHERE id = ? AND status = 'pending'`,
            args: [story, id],
          });
          summary.filedUnderApproved++;
          await recordDecision({ ...provenance, verdict: "discard", reason: `story_already_approved (story ${story})` });
        } else {
          await db.execute({ sql: "UPDATE raw_articles SET story_id = ? WHERE id = ?", args: [story, id] });
          if (story !== id) await recordDecision({ ...provenance, verdict: "join", reason: `story ${story}` });
        }
      }
    }
  } catch (err) {
    summary.failed = true;
    console.warn(`[story-fold] Matching failed, unmatched articles will be retried next run: ${err}`);
    log?.(`Story folding failed (${err instanceof Error ? err.message : err}) — will retry next run`);
  }
  return summary;
}
