/**
 * Positronitron core logic — extracted from the API route so both the
 * serverless endpoint and the unified self-hosted pipeline can call it.
 */

import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";
import { getSummariseProvider } from "@/lib/llm";
import { DEFAULT_SUMMARISE_STYLE } from "@/lib/prompts";
import { getSettings } from "@/lib/settings";
import { parseArticle } from "@/lib/parse-html";
import { acquireLock, lockHolder, releaseLock } from "@/lib/run-lock";
import { nextSlot, parseScheduleWallString, scheduleNow, toScheduleWallString } from "@/lib/schedule-time";
import { getStoredWeights, getWeight } from "@/lib/source-confidence";
import {
  findDuplicateHint,
  normaliseTitleTokens,
  type DuplicateCandidate,
} from "@/lib/title-similarity";

const DIGEST_PICK_COUNT = 2;

/** Settings row used as the Positronitron run lock. */
const LOCK_KEY = "positronitron_lock";

/**
 * How long a claim stays valid. A run summarises `positronitron_count`
 * articles through the LLM, so a few minutes is normal; 20 minutes is well
 * beyond that, and past it we assume the holder died mid-run.
 */
const LOCK_STALE_MS = 20 * 60_000;

/** How far back to look for already-published stories when de-duplicating. */
const DEDUP_WINDOW_DAYS = 14;

// ─── Types ───────────────────────────────────────────────────────────────────

export type TagRow = { id: number; name: string; emoji: string };

export interface PositronitronResult {
  ok: boolean;
  selected: number;
  candidates?: number;
  results?: Array<{ id: number; title: string; score: number; publish_date: string; featured: boolean }>;
  /** True when another run holds the lock and this invocation did nothing. */
  busy?: boolean;
  message?: string;
  error?: string;
  log: string[];
}

// ─── Article content fetcher ─────────────────────────────────────────────────

export async function fetchArticleContent(url: string): Promise<{ text: string; imageUrl: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PositronToday/1.0)" },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();

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

// ─── Summariser ──────────────────────────────────────────────────────────────

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
  const articleContext = sourceText
    ? `Article title: ${rawTitle ?? ""}\nArticle text:\n${sourceText}`
    : rawTitle
    ? `The full article text is not available. Use this title: "${rawTitle}". Output valid JSON — never explain that you cannot summarize.`
    : `No article text or title available. Write a short positive teaser based on the source name and URL. Output valid JSON.`;

  const tagInstructions = availableTags.length > 0
    ? `Available tags: ${availableTags.map((t) => t.name).join(", ")}
Pick 0-3 tags from that list that best fit this article. Only use names from the list exactly as written. Return them as the "suggested_tags" array.`
    : `No tags are defined yet. Return an empty "suggested_tags" array.`;

  const basePrompt = `${style}

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

  const systemPrompt =
    "You output only raw JSON. No prose, no markdown, no code fences, no explanation. " +
    "Every response must be a single complete JSON object with all 8 fields filled in.";

  const str = (v: unknown, fallback = "") =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;

  const MAX_ATTEMPTS = 2;
  const provider = await getSummariseProvider();
  let missingFields: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt =
      attempt > 1 && missingFields.length > 0
        ? `${basePrompt}\n\nRETRY ${attempt}/${MAX_ATTEMPTS}: Missing fields: ${missingFields.join(", ")}. Every field MUST contain text. Empty strings are not acceptable.`
        : basePrompt;

    const raw = await provider.generate(prompt, systemPrompt, 2400);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      missingFields = ["(no JSON found)"];
      if (attempt === MAX_ATTEMPTS) throw new Error(`LLM returned no JSON: ${raw.slice(0, 120)}`);
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      missingFields = ["(JSON parse error)"];
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

    missingFields = REQUIRED_TRANSLATION_FIELDS.filter((f) => !result[f]);
    if (missingFields.length === 0) return result;

    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`LLM missing fields after ${MAX_ATTEMPTS} attempts: ${missingFields.join(", ")}`);
    }
  }

  throw new Error("Unreachable");
}

// ─── Schedule gating ─────────────────────────────────────────────────────────

export async function findDueSlot(runTimesJson: string): Promise<{ due: boolean; slot: string; reason: string }> {
  let times: string[];
  try { times = JSON.parse(runTimesJson); } catch { times = ["08:00", "15:00"]; }

  const { date, totalMins } = scheduleNow();

  console.log(`[positronitron] Schedule check: date=${date}, time=${Math.floor(totalMins / 60)}:${String(totalMins % 60).padStart(2, "0")}, slots=${times.join(", ")}`);

  const completedResult = await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'positronitron_last_runs'",
    args: [],
  });
  let lastRuns: Record<string, string[]> = {};
  try {
    lastRuns = JSON.parse(String(completedResult.rows[0]?.value ?? "{}"));
  } catch { /* empty */ }
  const todaysRuns: string[] = lastRuns[date] ?? [];

  for (const slot of times) {
    const [h, m] = slot.split(":").map(Number);
    const slotMins = h * 60 + m;

    if (totalMins >= slotMins && !todaysRuns.includes(slot)) {
      return { due: true, slot, reason: `Slot ${slot} is due (Brussels time ${Math.floor(totalMins / 60)}:${String(totalMins % 60).padStart(2, "0")})` };
    }
  }

  return { due: false, slot: "", reason: `No slots due. Today's completed: [${todaysRuns.join(", ")}]` };
}

export async function markSlotCompleted(slot: string): Promise<void> {
  const { date } = scheduleNow();

  const result = await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'positronitron_last_runs'",
    args: [],
  });
  let lastRuns: Record<string, string[]> = {};
  try {
    lastRuns = JSON.parse(String(result.rows[0]?.value ?? "{}"));
  } catch { /* empty */ }

  const todaysRuns = lastRuns[date] ?? [];
  todaysRuns.push(slot);
  const cleaned: Record<string, string[]> = { [date]: todaysRuns };

  await db.execute({
    sql: `INSERT INTO settings (key, value) VALUES ('positronitron_last_runs', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [JSON.stringify(cleaned)],
  });
}

// ─── Near-duplicate pool ─────────────────────────────────────────────────────

type DedupItem = { title: string; origin: string };

/**
 * Titles of everything recently drafted, scheduled or published, for comparing
 * candidates against. All three translations go in: a candidate's raw title is
 * in its source language, so a Dutch headline only matches if the pool carries
 * the Dutch title of the story that already went out. Tokens from different
 * languages simply do not overlap, so the extra entries cost recall nothing.
 */
async function buildDedupPool(): Promise<DuplicateCandidate<DedupItem>[]> {
  const res = await db.execute(`
    SELECT title_en, title_nl, title_fr, status
    FROM articles
    WHERE status IN ('draft', 'scheduled', 'published')
      AND (created_at   >= datetime('now', '-${DEDUP_WINDOW_DAYS} days')
        OR published_at >= datetime('now', '-${DEDUP_WINDOW_DAYS} days'))
  `);

  const pool: DuplicateCandidate<DedupItem>[] = [];
  for (const row of res.rows) {
    const origin = String(row.status ?? "recent");
    for (const key of ["title_en", "title_nl", "title_fr"] as const) {
      const title = String(row[key] ?? "").trim();
      if (!title) continue;
      pool.push({ item: { title, origin }, tokens: normaliseTitleTokens(title) });
    }
  }

  // Also the original publisher headlines of everything already taken off the
  // queue. The titles above are LLM rewrites, so a candidate's raw headline
  // does not reliably match them; raw-against-raw is the strongest comparison
  // available, and it is what catches the same story arriving from two feeds
  // across consecutive runs rather than within one.
  const raws = await db.execute(`
    SELECT title, preview_title_en
    FROM raw_articles
    WHERE status = 'approved'
      AND fetched_at >= datetime('now', '-${DEDUP_WINDOW_DAYS} days')
  `);
  for (const row of raws.rows) {
    for (const key of ["title", "preview_title_en"] as const) {
      const title = String(row[key] ?? "").trim();
      if (!title) continue;
      pool.push({ item: { title, origin: "already picked" }, tokens: normaliseTitleTokens(title) });
    }
  }

  return pool;
}

// ─── Main pipeline logic ─────────────────────────────────────────────────────

export async function runPositronitron(options: { isManual: boolean }): Promise<PositronitronResult> {
  const settings = await getSettings();
  const { isManual } = options;
  const mode = settings.positronitron_mode;

  if (!isManual && mode !== "summarise" && mode !== "full") {
    return {
      ok: false, selected: 0, log: [],
      message: `Positronitron mode is "${mode}" — summarise step is disabled. Enable summarise or full mode in Settings.`,
    };
  }

  // The lock is taken BEFORE the due-slot check, because that check is the read
  // half of the read-then-write this guards: the slot is only marked completed
  // once the run finishes, so without the lock every invocation during a run
  // still sees the slot as due, re-selects the same top-N pending rows, and
  // publishes them again. An in-process flag is not enough — `/api/positronitron`
  // (cron) and the unified pipeline are separate trigger paths, and the flag
  // does not survive a container restart.
  const lock = await acquireLock(LOCK_KEY, isManual ? "manual" : "scheduled", LOCK_STALE_MS);
  if (!lock) {
    const holder = await lockHolder(LOCK_KEY, LOCK_STALE_MS);
    const message = holder
      ? `A ${holder.label} run is already in progress (started ${Math.round((Date.now() - holder.at) / 1000)}s ago)`
      : "Another Positronitron run is already in progress";
    console.log(`[positronitron] ${message}`);
    return { ok: true, selected: 0, busy: true, log: [], message };
  }

  try {
    return await runPositronitronLocked(options, settings, mode);
  } finally {
    await releaseLock(LOCK_KEY, lock.token);
  }
}

/** The actual run. Only ever called with the run lock held. */
async function runPositronitronLocked(
  options: { isManual: boolean },
  settings: Awaited<ReturnType<typeof getSettings>>,
  mode: string,
): Promise<PositronitronResult> {
  const { isManual } = options;
  const schedulePublish = isManual || mode === "full";

  let dueSlot = "";
  if (!isManual) {
    // Re-checked inside the lock. A run that queued behind another must not
    // redo the slot that run just completed.
    const schedule = await findDueSlot(settings.positronitron_run_times ?? '["08:00","15:00"]');
    console.log(`[positronitron] ${schedule.reason}`);
    if (!schedule.due) {
      return { ok: false, selected: 0, log: [], message: schedule.reason };
    }
    dueSlot = schedule.slot;

    // Claim the slot up front rather than on the way out. The lock already
    // serialises concurrent runs, but marking early also closes the window
    // between this run releasing the lock and the next cron tick: the slot is
    // spent whether or not the work below succeeds.
    await markSlotCompleted(dueSlot);
  }

  const targetCount = parseInt(settings.positronitron_count) || 3;
  const intervalMinutes = 30;
  const style = settings.summarise_style_override || DEFAULT_SUMMARISE_STYLE;

  const log: string[] = [];
  const L = (msg: string) => {
    console.log(`[positronitron] ${msg}`);
    log.push(msg);
  };

  L(`Starting run (mode=${mode}${isManual ? ", manual" : ""}) — selecting top ${targetCount} articles from queue`);

  try {
    const weights = await getStoredWeights();
    if (weights) {
      L(`Using source confidence weights (computed ${weights.computed_at}, ${Object.keys(weights.weights).length} sources, global confidence ${(weights.global_confidence * 100).toFixed(1)}%)`);
    } else {
      L("No source confidence weights found — ranking by raw positivity score");
    }

    const queueResult = await db.execute(`
      SELECT r.id, r.source_id, r.url, r.title, r.content, r.source_pub_date,
             r.positivity_score, s.name as source_name
      FROM raw_articles r
      JOIN sources s ON r.source_id = s.id
      WHERE r.status = 'pending'
        AND r.positivity_score IS NOT NULL
      ORDER BY r.positivity_score DESC
    `);

    const ranked = queueResult.rows.map(row => {
      const score = Number(row.positivity_score ?? 7);
      const w = getWeight(weights, Number(row.source_id));
      return { row, composite_score: score * w, source_weight: w };
    });
    ranked.sort((a, b) => b.composite_score - a.composite_score);

    // Near-duplicate filter. Until now this ran only in the admin Preview queue
    // (GET /api/articles), as a hint for a human reviewer to act on. In full
    // automation nobody reads that hint, so the same story arriving via two
    // feeds — distinct URLs, so raw_articles.url UNIQUE does not catch it, and
    // near-identical scores, so they sort adjacent — went out twice.
    const recentPool = await buildDedupPool();
    const selected: typeof ranked = [];
    for (const entry of ranked) {
      if (selected.length >= targetCount) break;
      const title = String(entry.row.preview_title_en || entry.row.title || "");
      const tokens = normaliseTitleTokens(title);
      const hint = findDuplicateHint(tokens, recentPool);
      if (hint) {
        L(`  ✕ skipped "${title}" — ${(hint.similarity * 100).toFixed(0)}% similar to "${hint.match.title}" (${hint.match.origin})`);
        continue;
      }
      selected.push(entry);
      // Add to the pool so the rest of this same batch is compared against it.
      recentPool.push({ item: { title, origin: "this run" }, tokens });
    }

    if (weights && selected.length > 0) {
      for (const { row: c, composite_score, source_weight } of selected) {
        L(`  → "${c.title}" (score ${Number(c.positivity_score).toFixed(0)} × ${source_weight.toFixed(2)}x = ${composite_score.toFixed(1)}) [${c.source_name}]`);
      }
    }

    // Claim the rows before doing any work on them. The UPDATE is atomic and
    // conditional on the row still being 'pending', so if anything else has
    // taken a candidate in the meantime, rowsAffected tells us and we drop it.
    // Defence in depth: the lock above should already prevent this.
    const candidates: typeof queueResult.rows = [];
    for (const { row } of selected) {
      const claim = await db.execute({
        sql: "UPDATE raw_articles SET status = 'approved' WHERE id = ? AND status = 'pending'",
        args: [Number(row.id)],
      });
      if (claim.rowsAffected > 0) {
        candidates.push(row);
      } else {
        L(`  ✕ skipped "${row.title}" — already claimed by another run`);
      }
    }

    L(`Found ${candidates.length} candidates in queue (wanted ${targetCount}, pool ${ranked.length})`);

    if (candidates.length === 0) {
      if (dueSlot) L(`Slot ${dueSlot} claimed (no candidates available)`);
      return { ok: true, selected: 0, log, message: "No articles in queue. Run the pipeline first to fetch and classify articles." };
    }

    const tagsResult = await db.execute("SELECT id, name, emoji FROM topics ORDER BY name ASC");
    const availableTags: TagRow[] = tagsResult.rows.map((t) => ({
      id: Number(t.id),
      name: String(t.name),
      emoji: String(t.emoji),
    }));
    const tagNameMap = new Map(availableTags.map((t) => [t.name.toLowerCase(), t]));

    const latestResult = await db.execute(`
      SELECT MAX(publish_date) as latest FROM articles
      WHERE status = 'scheduled' AND publish_date IS NOT NULL AND publish_date != ''
    `);
    const latestRaw = latestResult.rows[0]?.latest as string | null;
    const latestExisting = latestRaw ? parseScheduleWallString(latestRaw) : null;
    const now = new Date();
    const startAfter = latestExisting && latestExisting > now ? latestExisting : now;
    let scheduleCursor = nextSlot(startAfter, intervalMinutes);

    const results: Array<{ id: number; title: string; score: number; publish_date: string; featured: boolean }> = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const rawId = Number(c.id);
      const isFeatured = i === 0;
      const isDigestPick = mode === "full" && i < DIGEST_PICK_COUNT;
      const score = Number(c.positivity_score ?? 7);

      try {
        // INSERT OR IGNORE, and then trust rowsAffected rather than
        // lastInsertRowid. Until the unique index on raw_article_id exists this
        // statement cannot actually conflict, but once it can, lastInsertRowid
        // would still hold the id of this connection's previous insert — and
        // the UPDATE below would then overwrite an unrelated article.
        const articleInsert = await db.execute({
          sql: `INSERT OR IGNORE INTO articles (raw_article_id, source_url, source_name, status, positivity_score)
                VALUES (?, ?, ?, 'draft', ?)`,
          args: [rawId, c.url, c.source_name, score],
        });
        if (articleInsert.rowsAffected === 0) {
          L(`Skipped "${c.title}" — an article row already exists for this source article`);
          continue;
        }
        const articleId = Number(articleInsert.lastInsertRowid);
        // raw_articles was already claimed as 'approved' before this loop.

        L(`Summarising: "${c.title}"`);
        const { text: articleText, imageUrl } = await fetchArticleContent(String(c.url));
        const summaries = await summariseAndTranslate(
          articleText, String(c.url), String(c.source_name),
          String(c.title), availableTags, style,
        );

        const dateStr = schedulePublish ? toScheduleWallString(scheduleCursor) : null;
        await db.execute({
          sql: `UPDATE articles SET
                  title_nl = ?, title_fr = ?, title_en = ?,
                  summary_nl = ?, summary_fr = ?, summary_en = ?,
                  article_emoji = ?, image_url = ?,
                  status = ?, publish_date = ?,
                  post_to_social_on_publish = 1,
                  featured = ?,
                  digest_pick = ?
                WHERE id = ?`,
          args: [
            summaries.title_nl, summaries.title_fr, summaries.title_en,
            summaries.summary_nl, summaries.summary_fr, summaries.summary_en,
            summaries.emoji, imageUrl,
            schedulePublish ? "scheduled" : "draft",
            dateStr,
            isFeatured ? 1 : 0,
            isDigestPick ? 1 : 0,
            articleId,
          ],
        });

        const matchedTags = summaries.suggested_tags
          .map((name) => tagNameMap.get(String(name).toLowerCase()))
          .filter((t): t is TagRow => t !== undefined);
        await db.execute({ sql: "DELETE FROM article_tags WHERE article_id = ?", args: [articleId] });
        for (const tag of matchedTags) {
          await db.execute({
            sql: "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)",
            args: [articleId, tag.id],
          });
        }

        results.push({
          id: articleId, title: summaries.title_en, score,
          publish_date: dateStr ?? "", featured: isFeatured,
        });

        const flags = [
          isFeatured ? "⭐ FEATURED" : "",
          isDigestPick ? "📰 DIGEST" : "",
        ].filter(Boolean).join(" ");

        if (schedulePublish) {
          L(`Scheduled: "${summaries.title_en}" at ${dateStr}${flags ? ` ${flags}` : ""} (score: ${score})`);
          scheduleCursor = nextSlot(scheduleCursor, intervalMinutes);
        } else {
          L(`Drafted: "${summaries.title_en}"${flags ? ` ${flags}` : ""} (score: ${score}) — awaiting review`);
        }
      } catch (err) {
        L(`Error processing "${c.title}": ${err}`);
      }
    }

    try { await exportRejections(); } catch { /* ok */ }

    if (dueSlot) L(`Slot ${dueSlot} completed for today`);

    L(`Done — ${results.length} articles ${schedulePublish ? "scheduled" : "drafted"}`);

    return { ok: true, selected: results.length, candidates: candidates.length, results, log };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    L(`Fatal error: ${message}`);
    return { ok: false, selected: 0, error: message, log };
  }
}
