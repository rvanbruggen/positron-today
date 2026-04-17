/**
 * Positronitron — Autonomous Publishing Pipeline
 *
 * Picks the top N positive articles from the raw_articles queue (populated
 * by /api/fetch), summarises them, and schedules them for publishing.
 *
 * This route no longer fetches RSS sources itself — that's handled by
 * /api/fetch (called separately by the Synology cron with ?auto=1).
 * This keeps each call well within Vercel's 60-second timeout.
 *
 * Flow:
 *   1. Pick top N articles from raw_articles by positivity score
 *   2. Auto-approve each
 *   3. Summarise (EN / NL / FR titles + summaries, emoji, tags)
 *   4. Schedule with staggered publish times + social posting enabled
 *   5. Mark the highest-scored article as featured
 *
 * Schedule gating: tracks completed slots per day in the database.
 * Each cron hit checks if any configured slot has passed and hasn't
 * been served yet. Resilient to irregular cron timing.
 *
 * GET  /api/positronitron — status check (enabled? last run?)
 * POST /api/positronitron — run the pipeline
 */

import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";
import { getSummariseProvider } from "@/lib/llm";
import { DEFAULT_SUMMARISE_STYLE } from "@/lib/prompts";
import { getSettings } from "@/lib/settings";
import { parseArticle } from "@/lib/parse-html";

// ─── Article content fetcher ──────────────────────────────────────────────────

async function fetchArticleContent(url: string): Promise<{ text: string; imageUrl: string | null }> {
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

// ─── Summariser ───────────────────────────────────────────────────────────────

type TagRow = { id: number; name: string; emoji: string };

const REQUIRED_TRANSLATION_FIELDS = [
  "title_en", "title_nl", "title_fr",
  "summary_en", "summary_nl", "summary_fr",
] as const;

async function summariseAndTranslate(
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

// ─── Schedule helpers ────────────────────────────────────────────────────────

function nextSlot(after: Date, intervalMinutes: number, bufferMinutes = 2): Date {
  const t = new Date(after.getTime() + bufferMinutes * 60 * 1000);
  const totalMins = t.getHours() * 60 + t.getMinutes();
  const rounded = Math.ceil(totalMins / intervalMinutes) * intervalMinutes;
  const jitter = 1 + Math.floor(Math.random() * 9);
  const result = new Date(t);
  result.setHours(Math.floor((rounded + jitter) / 60), (rounded + jitter) % 60, 0, 0);
  if (result <= after) result.setDate(result.getDate() + 1);
  return result;
}

function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  );
}

// ─── Timezone helper ─────────────────────────────────────────────────────────

function brusselsNow(): { date: string; hours: number; minutes: number; totalMins: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const hours = parseInt(get("hour"), 10);
  const minutes = parseInt(get("minute"), 10);
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hours,
    minutes,
    totalMins: hours * 60 + minutes,
  };
}

// ─── Schedule gating ─────────────────────────────────────────────────────────

async function findDueSlot(runTimesJson: string): Promise<{ due: boolean; slot: string; reason: string }> {
  let times: string[];
  try { times = JSON.parse(runTimesJson); } catch { times = ["08:00", "15:00"]; }

  const { date, totalMins } = brusselsNow();

  console.log(`[positronitron] Schedule check: Brussels date=${date}, time=${Math.floor(totalMins / 60)}:${String(totalMins % 60).padStart(2, "0")}, slots=${times.join(", ")}`);

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

async function markSlotCompleted(slot: string): Promise<void> {
  const { date } = brusselsNow();

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

// ─── GET — status check ──────────────────────────────────────────────────────

export async function GET() {
  const settings = await getSettings();
  return Response.json({
    enabled: settings.positronitron_enabled === "true",
    count: parseInt(settings.positronitron_count) || 3,
  });
}

// ─── POST — run the pipeline ─────────────────────────────────────────────────

export async function POST(request: Request) {
  const settings = await getSettings();
  const url = new URL(request.url);
  const isManual = url.searchParams.get("manual") === "1";

  if (settings.positronitron_enabled !== "true") {
    return Response.json({
      ok: false,
      message: "Positronitron is disabled. Enable it in Settings.",
    });
  }

  // When called by cron (not manual), check if any slot is due
  let dueSlot = "";
  if (!isManual) {
    const schedule = await findDueSlot(settings.positronitron_run_times ?? '["08:00","15:00"]');
    console.log(`[positronitron] ${schedule.reason}`);
    if (!schedule.due) {
      return Response.json({
        ok: false,
        message: schedule.reason,
      });
    }
    dueSlot = schedule.slot;
  }

  const targetCount = parseInt(settings.positronitron_count) || 3;
  const intervalMinutes = 30;
  const style = settings.summarise_style_override || DEFAULT_SUMMARISE_STYLE;

  const log: string[] = [];
  const L = (msg: string) => {
    console.log(`[positronitron] ${msg}`);
    log.push(msg);
  };

  L(`Starting run — selecting top ${targetCount} articles from queue`);

  try {
    // ── Phase 1: Pick top N from raw_articles queue ─────────────────────────
    // Articles are already fetched and positivity-filtered by /api/fetch.
    // We just pick the highest-scored ones that haven't been approved yet.

    const queueResult = await db.execute(`
      SELECT r.id, r.source_id, r.url, r.title, r.content, r.source_pub_date,
             r.positivity_score, s.name as source_name
      FROM raw_articles r
      JOIN sources s ON r.source_id = s.id
      WHERE r.status = 'pending'
        AND r.positivity_score IS NOT NULL
      ORDER BY r.positivity_score DESC
      LIMIT ?
    `, [targetCount]);

    const candidates = queueResult.rows;
    L(`Found ${candidates.length} candidates in queue (wanted ${targetCount})`);

    if (candidates.length === 0) {
      if (dueSlot) {
        await markSlotCompleted(dueSlot);
        L(`Marked slot ${dueSlot} as completed (no candidates available)`);
      }
      return Response.json({ ok: true, selected: 0, log, message: "No articles in queue. Make sure /api/fetch has run first." });
    }

    // ── Phase 2: Summarise and schedule each ────────────────────────────────

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
    const latestExisting = latestRaw ? new Date(latestRaw) : null;
    const now = new Date();
    const startAfter = latestExisting && latestExisting > now ? latestExisting : now;
    let scheduleCursor = nextSlot(startAfter, intervalMinutes);

    const results: Array<{ id: number; title: string; score: number; publish_date: string; featured: boolean }> = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const rawId = Number(c.id);
      const isFeatured = i === 0; // highest score = featured
      const score = Number(c.positivity_score ?? 7);

      try {
        // Auto-approve: create article record
        const articleInsert = await db.execute({
          sql: `INSERT OR IGNORE INTO articles (raw_article_id, source_url, source_name, status, positivity_score)
                VALUES (?, ?, ?, 'draft', ?)`,
          args: [rawId, c.url, c.source_name, score],
        });
        const articleId = Number(articleInsert.lastInsertRowid);
        await db.execute({ sql: "UPDATE raw_articles SET status = 'approved' WHERE id = ?", args: [rawId] });

        // Fetch full content + summarise
        L(`Summarising: "${c.title}"`);
        const { text: articleText, imageUrl } = await fetchArticleContent(String(c.url));
        const summaries = await summariseAndTranslate(
          articleText,
          String(c.url),
          String(c.source_name),
          String(c.title),
          availableTags,
          style,
        );

        // Update article with summaries and schedule
        const dateStr = toLocalISO(scheduleCursor);
        await db.execute({
          sql: `UPDATE articles SET
                  title_nl = ?, title_fr = ?, title_en = ?,
                  summary_nl = ?, summary_fr = ?, summary_en = ?,
                  article_emoji = ?, image_url = ?,
                  status = 'scheduled', publish_date = ?,
                  post_to_social_on_publish = 1,
                  featured = ?
                WHERE id = ?`,
          args: [
            summaries.title_nl, summaries.title_fr, summaries.title_en,
            summaries.summary_nl, summaries.summary_fr, summaries.summary_en,
            summaries.emoji, imageUrl, dateStr,
            isFeatured ? 1 : 0,
            articleId,
          ],
        });

        // Apply suggested tags
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
          id: articleId,
          title: summaries.title_en,
          score,
          publish_date: dateStr,
          featured: isFeatured,
        });

        L(`Scheduled: "${summaries.title_en}" at ${dateStr}${isFeatured ? " ⭐ FEATURED" : ""} (score: ${score})`);
        scheduleCursor = nextSlot(scheduleCursor, intervalMinutes);
      } catch (err) {
        L(`Error processing "${c.title}": ${err}`);
      }
    }

    // Export rejection log
    try { await exportRejections(); } catch { /* ok */ }

    // Mark the slot as completed so it won't fire again today
    if (dueSlot) {
      await markSlotCompleted(dueSlot);
      L(`Marked slot ${dueSlot} as completed for today`);
    }

    L(`Done — ${results.length} articles scheduled`);

    return Response.json({
      ok: true,
      selected: results.length,
      candidates: candidates.length,
      results,
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    L(`Fatal error: ${message}`);
    return Response.json({ ok: false, error: message, log }, { status: 500 });
  }
}
