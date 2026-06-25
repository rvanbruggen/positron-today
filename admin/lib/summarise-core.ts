/**
 * Summarise core — shared logic for turning an approved draft article into a
 * fully-translated, scheduled summary card.
 *
 * Used by two callers:
 *   1. POST /api/summarise            — summarise a single draft (synchronous)
 *   2. lib runSummariseDrafts()       — summarise ALL drafts server-side in the
 *                                        background, driven by
 *                                        POST /api/summarise-drafts/start
 *
 * The background runner mirrors the fetch/classify pipeline (unified-pipeline.ts
 * + pipeline_runs): work happens entirely on the server with progress written to
 * the `summarise_runs` table, so the browser is a read-only viewer that can
 * disconnect at any time without stopping the run.
 */

import db from "@/lib/db";
import { getSummariseProvider } from "@/lib/llm";
import { DEFAULT_SUMMARISE_STYLE } from "@/lib/prompts";
import { getSettings } from "@/lib/settings";
import { parseArticle } from "@/lib/parse-html";
import { nextSlot, parseScheduleWallString, toScheduleWallString } from "@/lib/schedule-time";

const DEFAULT_SUGGEST_INTERVAL_MINUTES = 30;

// ─── Schedule slot suggestion ─────────────────────────────────────────────────

// Chain the next suggested slot after the latest currently-scheduled article's
// publish_date (or from now if nothing is scheduled / the latest is in the past).
// Mirrors /api/suggest-schedule's cadence so a freshly summarised article slots
// naturally onto the end of the queue without the user having to press the
// "Suggest schedule" button.
export async function suggestNextSlot(intervalMinutes: number): Promise<string> {
  const latest = await db.execute(`
    SELECT MAX(publish_date) as max_date
    FROM articles
    WHERE status = 'scheduled' AND publish_date IS NOT NULL
  `);
  const maxDateStr = latest.rows[0]?.max_date ? String(latest.rows[0].max_date) : null;

  let cursor = new Date();
  if (maxDateStr) {
    try {
      const parsed = parseScheduleWallString(maxDateStr);
      if (parsed > cursor) cursor = parsed;
    } catch {
      // Malformed stored value — fall back to "now".
    }
  }
  return toScheduleWallString(nextSlot(cursor, intervalMinutes));
}

// ─── Article content fetcher ──────────────────────────────────────────────────

export async function fetchArticleContent(url: string): Promise<{ text: string; imageUrl: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PositronToday/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();

    // Extract og:image for card thumbnails
    const imgMatch =
      html.match(/property="og:image"\s+content="([^"]+)"/i) ||
      html.match(/content="([^"]+)"\s+property="og:image"/i);
    const imageUrl = imgMatch ? imgMatch[1].trim() : null;

    const descMatch =
      html.match(/property="og:description"\s+content="([^"]{30,})"/i) ||
      html.match(/content="([^"]{30,})"\s+property="og:description"/i) ||
      html.match(/name="description"\s+content="([^"]{30,})"/i);
    const metaDesc = descMatch ? descMatch[1].trim() : "";

    const article = parseArticle(html, url);
    const readabilityText = article?.textContent?.trim() ?? "";

    const text = readabilityText.length > 200
      ? readabilityText.slice(0, 4000)
      : metaDesc.slice(0, 1000);

    return { text, imageUrl };
  } catch {
    return { text: "", imageUrl: null };
  }
}

// ─── Summariser ───────────────────────────────────────────────────────────────

export type TagRow = { id: number; name: string; emoji: string };

// All six text fields must be non-empty for a summary to be accepted.
const REQUIRED_TRANSLATION_FIELDS = [
  "title_en", "title_nl", "title_fr",
  "summary_en", "summary_nl", "summary_fr",
] as const;

export async function summariseAndTranslate(
  sourceText: string,
  sourceUrl: string,
  sourceName: string,
  rawTitle: string | null,
  availableTags: TagRow[],
  style: string,
): Promise<{
  title_nl: string; title_fr: string; title_en: string;
  summary_nl: string; summary_fr: string; summary_en: string;
  emoji: string;
  suggested_tags: string[];
}> {
  const STYLE = style;

  const articleContext = sourceText
    ? `Article title: ${rawTitle ?? ""}\nArticle text:\n${sourceText}`
    : rawTitle
    ? `The full article text is not available (paywalled or JS-rendered). Use this title to write the summary card: "${rawTitle}". Do not mention that the text was unavailable. You MUST still output valid JSON — never explain that you cannot summarize.`
    : `No article text or title available. Write a short positive teaser based only on the source name and URL. You MUST still output valid JSON.`;

  const tagInstructions = availableTags.length > 0
    ? `Available tags: ${availableTags.map((t) => t.name).join(", ")}
Pick 0-3 tags from that list that best fit this article. Only use names from the list exactly as written. Return them as the "suggested_tags" array.`
    : `No tags are defined yet. Return an empty "suggested_tags" array.`;

  const basePrompt = `${STYLE}

Write a summary card for an article from ${sourceName} (${sourceUrl}).

${articleContext}

Also pick a single emoji that best represents the mood or subject of this specific article.

${tagInstructions}

Output ONLY this exact JSON object and nothing else. All fields are required:
{
  "title_en": "Title in English",
  "title_nl": "Titel in het Nederlands",
  "title_fr": "Titre en français",
  "summary_en": "4-5 sentence summary written in English.",
  "summary_nl": "Samenvatting van 4-5 zinnen geschreven in het Nederlands.",
  "summary_fr": "Résumé de 4-5 phrases écrit en français.",
  "emoji": "🌟",
  "suggested_tags": []
}`;

  const systemPrompt = "You output only raw JSON. No prose, no markdown, no code fences, no explanation. Every response must be a single complete JSON object with all 8 fields filled in.";

  const str = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  const MAX_ATTEMPTS = 2;
  const provider = await getSummariseProvider();
  let missingFields: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // On retries, append a targeted reminder so the model knows exactly what it missed.
    const prompt = (attempt > 1 && missingFields.length > 0)
      ? `${basePrompt}\n\nRETRY ${attempt}/${MAX_ATTEMPTS}: Your previous response had these fields empty or missing: ${missingFields.join(", ")}. Every field MUST contain text in the correct language. Empty strings are not acceptable.`
      : basePrompt;

    const raw = await provider.generate(prompt, systemPrompt, 2400);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      missingFields = ["(no JSON found in response)"];
      console.warn(`[summarise] attempt ${attempt}/${MAX_ATTEMPTS}: ${missingFields[0]}`);
      if (attempt === MAX_ATTEMPTS) throw new Error(`Unexpected LLM response: ${raw.slice(0, 120)}`);
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      missingFields = ["(JSON parse error)"];
      console.warn(`[summarise] attempt ${attempt}/${MAX_ATTEMPTS}: JSON parse failed`);
      if (attempt === MAX_ATTEMPTS) throw new Error(`LLM returned invalid JSON after ${MAX_ATTEMPTS} attempts`);
      continue;
    }

    const result = {
      title_nl:       str(parsed.title_nl),
      title_fr:       str(parsed.title_fr),
      title_en:       str(parsed.title_en),
      summary_nl:     str(parsed.summary_nl),
      summary_fr:     str(parsed.summary_fr),
      summary_en:     str(parsed.summary_en),
      emoji:          str(parsed.emoji, "✨"),
      suggested_tags: Array.isArray(parsed.suggested_tags) ? parsed.suggested_tags : [],
    };

    missingFields = REQUIRED_TRANSLATION_FIELDS.filter(f => !result[f]);

    if (missingFields.length === 0) return result;  // ✓ all fields present

    console.warn(`[summarise] attempt ${attempt}/${MAX_ATTEMPTS}: missing fields: ${missingFields.join(", ")}`);
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(
        `LLM failed to provide all translations after ${MAX_ATTEMPTS} attempts. ` +
        `Missing: ${missingFields.join(", ")}`
      );
    }
  }

  // Unreachable — TypeScript needs this.
  throw new Error("Unreachable");
}

// ─── Single-draft summarisation ───────────────────────────────────────────────

export interface SummariseDraftResult {
  ok: true;
  title_nl: string; title_fr: string; title_en: string;
  summary_nl: string; summary_fr: string; summary_en: string;
  emoji: string;
  matched_tags: TagRow[];
  image_url: string | null;
  publish_date: string;
}

/**
 * Summarise one draft article: fetch its content, run the summarise model for
 * EN/NL/FR title+summary+emoji+tags, capture the og:image, assign a suggested
 * publish slot, and persist everything (moving the article to `scheduled`).
 *
 * Throws on failure — callers decide how to surface the error.
 */
export async function summariseDraft(id: number): Promise<SummariseDraftResult> {
  // Fetch article and all available tags in parallel
  const [articleResult, tagsResult] = await Promise.all([
    db.execute({
      sql: `SELECT a.*, r.title as raw_title
            FROM articles a
            LEFT JOIN raw_articles r ON a.raw_article_id = r.id
            WHERE a.id = ?`,
      args: [id],
    }),
    db.execute("SELECT id, name, emoji FROM topics ORDER BY name ASC"),
  ]);

  const article = articleResult.rows[0];
  if (!article) throw new Error("Article not found");

  const availableTags: TagRow[] = tagsResult.rows.map((t) => ({
    id: Number(t.id),
    name: String(t.name),
    emoji: String(t.emoji),
  }));

  const { text: articleText, imageUrl } = await fetchArticleContent(String(article.source_url));
  const rawTitle = article.raw_title ? String(article.raw_title) : null;

  const settings = await getSettings();
  const style = settings.summarise_style_override || DEFAULT_SUMMARISE_STYLE;

  const summaries = await summariseAndTranslate(
    articleText,
    String(article.source_url),
    String(article.source_name),
    rawTitle,
    availableTags,
    style,
  );

  // Suggest a publish slot up-front so a freshly summarised article lands
  // on "Ready to publish" already scheduled. Only fills empty slots — if
  // the user had already set publish_date before re-summarising, preserve it.
  const existingPublishDate = article.publish_date ? String(article.publish_date) : null;
  const suggestedPublishDate = existingPublishDate
    ? existingPublishDate
    : await suggestNextSlot(DEFAULT_SUGGEST_INTERVAL_MINUTES);

  // Save summaries + emoji + og:image + suggested publish slot
  await db.execute({
    sql: `UPDATE articles SET
            title_nl = ?, title_fr = ?, title_en = ?,
            summary_nl = ?, summary_fr = ?, summary_en = ?,
            article_emoji = ?,
            image_url = ?,
            publish_date = ?,
            status = 'scheduled'
          WHERE id = ?`,
    args: [
      summaries.title_nl, summaries.title_fr, summaries.title_en,
      summaries.summary_nl, summaries.summary_fr, summaries.summary_en,
      summaries.emoji,
      imageUrl,
      suggestedPublishDate,
      id,
    ],
  });

  // Match the model's suggested tag names against actual tags (case-insensitive)
  const tagNameMap = new Map(availableTags.map((t) => [t.name.toLowerCase(), t]));
  const matchedTags = summaries.suggested_tags
    .map((name) => tagNameMap.get(String(name).toLowerCase()))
    .filter((t): t is TagRow => t !== undefined);

  // Replace article's tags with the suggested set
  await db.execute({ sql: "DELETE FROM article_tags WHERE article_id = ?", args: [id] });
  for (const tag of matchedTags) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)",
      args: [id, tag.id],
    });
  }

  return {
    ok: true,
    ...summaries,
    matched_tags: matchedTags,
    image_url: imageUrl,
    publish_date: suggestedPublishDate,
  };
}

// ─── Background bulk runner ────────────────────────────────────────────────────

let running = false;
let activeRunId: number | null = null;
let cancelRequested = false;

export function isSummariseDraftsRunning(): boolean {
  return running;
}

export function getActiveSummariseRunId(): number | null {
  return activeRunId;
}

export function requestSummariseCancel(): void {
  cancelRequested = true;
}

type SummariseLogLine = { id: number; ok: boolean; title?: string; error?: string };

/**
 * Summarise every `draft` article server-side, one at a time, writing progress
 * to the `summarise_runs` table. Returns the run id. Safe to fire-and-forget:
 * the work continues regardless of whether any browser is connected.
 */
export async function runSummariseDrafts(): Promise<number | null> {
  if (running) {
    console.log("[summarise-drafts] Already running, skipping");
    return activeRunId;
  }

  running = true;
  cancelRequested = false;

  // Snapshot the drafts up front — summariseDraft() flips status to 'scheduled'
  // so re-querying mid-run would shrink the set.
  const draftRows = await db.execute(`
    SELECT a.id, r.title AS raw_title
    FROM articles a
    LEFT JOIN raw_articles r ON a.raw_article_id = r.id
    WHERE a.status = 'draft'
    ORDER BY a.id ASC
  `);
  const drafts = draftRows.rows.map((row) => ({
    id: Number(row.id),
    title: row.raw_title ? String(row.raw_title) : `Article #${row.id}`,
  }));

  const runInsert = await db.execute({
    sql: "INSERT INTO summarise_runs (status, total) VALUES ('running', ?)",
    args: [drafts.length],
  });
  const runId = Number(runInsert.lastInsertRowid);
  activeRunId = runId;

  console.log(`[summarise-drafts] Starting run #${runId} — ${drafts.length} drafts`);

  let succeeded = 0, failed = 0, done = 0;
  const log: SummariseLogLine[] = [];

  try {
    for (const draft of drafts) {
      if (cancelRequested) {
        console.log(`[summarise-drafts] Run #${runId} cancelled after ${done}/${drafts.length}`);
        break;
      }

      await db.execute({
        sql: "UPDATE summarise_runs SET current_title = ? WHERE id = ?",
        args: [draft.title, runId],
      });

      try {
        const res = await summariseDraft(draft.id);
        succeeded++;
        log.push({ id: draft.id, ok: true, title: res.title_en });
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[summarise-drafts] Failed "${draft.title}": ${message}`);
        log.push({ id: draft.id, ok: false, title: draft.title, error: message });
      }

      done++;
      await db.execute({
        sql: "UPDATE summarise_runs SET done = ?, succeeded = ?, failed = ?, log = ? WHERE id = ?",
        args: [done, succeeded, failed, JSON.stringify(log), runId],
      });
    }

    await db.execute({
      sql: `UPDATE summarise_runs SET status = 'done', current_title = NULL, finished_at = datetime('now') WHERE id = ?`,
      args: [runId],
    });
    console.log(`[summarise-drafts] Run #${runId} done — ${succeeded} ok, ${failed} failed`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.execute({
      sql: `UPDATE summarise_runs SET status = 'error', error_message = ?, current_title = NULL, finished_at = datetime('now') WHERE id = ?`,
      args: [message, runId],
    });
    console.error(`[summarise-drafts] Run #${runId} error: ${message}`);
  } finally {
    running = false;
    activeRunId = null;
  }

  return runId;
}
