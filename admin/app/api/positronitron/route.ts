/**
 * Positronitron — Autonomous Publishing Pipeline
 *
 * Runs the full article lifecycle unattended:
 *   1. Fetch all active RSS sources
 *   2. Filter with maximum positivity strictness (threshold 10)
 *   3. Keep only the top N articles by positivity score
 *   4. Summarise each (EN / NL / FR titles + summaries, emoji, tags)
 *   5. Schedule with staggered publish times + social posting enabled
 *   6. Mark the highest-scored article as featured
 *
 * Designed to be called by launchd at 08:00 and 15:00.
 * Respects the positronitron_enabled setting — returns early when off.
 *
 * GET  /api/positronitron — status check (enabled? last run?)
 * POST /api/positronitron — run the pipeline
 */

import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";
import { getFilterProvider, getSummariseProvider } from "@/lib/llm";
import { buildFilterInstructions, buildFilterPrompt, DEFAULT_SUMMARISE_STYLE } from "@/lib/prompts";
import { CATEGORY_SLUGS } from "@/lib/rejection-categories";
import { getSettings } from "@/lib/settings";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import RSSParser from "rss-parser";

const parser = new RSSParser();

// ─── Positivity filter ────────────────────────────────────────────────────────

async function checkPositivity(
  title: string,
  snippet: string,
  filterInstructions: string,
): Promise<{ fits: boolean; reason: string; category: string; score?: number }> {
  const provider = await getFilterProvider();
  const prompt = buildFilterPrompt(filterInstructions, title, snippet);
  const result = await provider.classify(prompt);
  return {
    fits: result.fits,
    reason: result.reason,
    category: result.category ?? "other-negative",
    score: result.score,
  };
}

// ─── Article content fetcher ──────────────────────────────────────────────────

async function fetchArticleContent(url: string): Promise<{ text: string; imageUrl: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PositronToday/1.0)" },
      signal: AbortSignal.timeout(10000),
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

    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
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

  const MAX_ATTEMPTS = 3;
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

// ─── GET — status check ──────────────────────────────────────────────────────

export async function GET() {
  const settings = await getSettings();
  return Response.json({
    enabled: settings.positronitron_enabled === "true",
    count: parseInt(settings.positronitron_count) || 3,
  });
}

// ─── POST — run the pipeline ─────────────────────────────────────────────────

export async function POST() {
  const settings = await getSettings();

  if (settings.positronitron_enabled !== "true") {
    return Response.json({
      ok: false,
      message: "Positronitron is disabled. Enable it in Settings.",
    });
  }

  const targetCount = parseInt(settings.positronitron_count) || 3;
  const intervalMinutes = 30;
  const filterInstructions = buildFilterInstructions(10);
  const style = settings.summarise_style_override || DEFAULT_SUMMARISE_STYLE;

  const log: string[] = [];
  const L = (msg: string) => {
    console.log(`[positronitron] ${msg}`);
    log.push(msg);
  };

  L(`Starting run — selecting top ${targetCount} articles`);

  try {
    // ── Phase 1: Fetch and filter all RSS sources ──────────────────────────

    const sourcesResult = await db.execute(
      "SELECT * FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss')"
    );
    const sources = sourcesResult.rows;
    L(`Found ${sources.length} active sources`);

    type Candidate = {
      title: string;
      link: string;
      snippet: string;
      sourceName: string;
      sourceId: number;
      score: number;
      sourcePubDate: string | null;
    };

    const candidates: Candidate[] = [];
    let totalFiltered = 0;
    let totalSkipped = 0;

    for (const source of sources) {
      const feedUrl = (source.feed_url ?? source.url) as string;

      try {
        const feed = await parser.parseURL(feedUrl);
        const items = feed.items.slice(0, 20).filter((i) => i.link && i.title);

        for (const item of items) {
          const [existingRaw, existingRejected] = await Promise.all([
            db.execute({ sql: "SELECT id FROM raw_articles WHERE url = ?", args: [item.link!] }),
            db.execute({ sql: "SELECT id FROM rejected_articles WHERE url = ?", args: [item.link!] }),
          ]);

          if (existingRaw.rows.length > 0 || existingRejected.rows.length > 0) {
            totalSkipped++;
            continue;
          }

          const snippet = item.contentSnippet ?? item.content ?? "";
          const sourcePubDate = item.isoDate
            ? item.isoDate.slice(0, 10)
            : item.pubDate
            ? new Date(item.pubDate).toISOString().slice(0, 10)
            : null;

          const { fits, reason, category, score } = await checkPositivity(
            item.title!,
            snippet,
            filterInstructions,
          );

          if (!fits) {
            totalFiltered++;
            const safeCategory = CATEGORY_SLUGS.includes(category) ? category : "other-negative";
            try {
              await db.execute({
                sql: `INSERT OR IGNORE INTO rejected_articles
                      (source_id, source_name, url, title, snippet, rejection_reason, rejection_category, source_pub_date)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [source.id, source.name as string, item.link!, item.title!, snippet.slice(0, 500), reason, safeCategory, sourcePubDate],
              });
            } catch { /* duplicate */ }
            continue;
          }

          candidates.push({
            title: item.title!,
            link: item.link!,
            snippet,
            sourceName: source.name as string,
            sourceId: Number(source.id),
            score: score ?? 7,
            sourcePubDate,
          });
        }
      } catch (err) {
        L(`Source error (${source.name}): ${err}`);
      }
    }

    L(`Filter done: ${candidates.length} passed, ${totalFiltered} rejected, ${totalSkipped} skipped`);

    if (candidates.length === 0) {
      // Export rejection log even when no articles pass
      try { await exportRejections(); } catch { /* ok */ }
      return Response.json({ ok: true, selected: 0, log, message: "No positive articles found" });
    }

    // ── Phase 2: Select top N by score ──────────────────────────────────────

    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates.slice(0, targetCount);
    L(`Selected top ${selected.length}: ${selected.map((c) => `"${c.title}" (${c.score})`).join(", ")}`);

    // ── Phase 3: Insert, summarise, and schedule each ───────────────────────

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
    const highestScoreIndex = 0; // already sorted descending

    for (let i = 0; i < selected.length; i++) {
      const c = selected[i];
      const isFeatured = i === highestScoreIndex;

      try {
        // Insert raw article
        const rawInsert = await db.execute({
          sql: "INSERT INTO raw_articles (source_id, url, title, content, source_pub_date, positivity_score) VALUES (?, ?, ?, ?, ?, ?)",
          args: [c.sourceId, c.link, c.title, c.snippet, c.sourcePubDate, c.score],
        });
        const rawId = Number(rawInsert.lastInsertRowid);

        // Create article record
        const articleInsert = await db.execute({
          sql: `INSERT OR IGNORE INTO articles (raw_article_id, source_url, source_name, status, positivity_score)
                VALUES (?, ?, ?, 'draft', ?)`,
          args: [rawId, c.link, c.sourceName, c.score],
        });
        const articleId = Number(articleInsert.lastInsertRowid);
        await db.execute({ sql: "UPDATE raw_articles SET status = 'approved' WHERE id = ?", args: [rawId] });

        // Fetch full content + summarise
        L(`Summarising: "${c.title}"`);
        const { text: articleText, imageUrl } = await fetchArticleContent(c.link);
        const summaries = await summariseAndTranslate(
          articleText,
          c.link,
          c.sourceName,
          c.title,
          availableTags,
          style,
        );

        // Update article with summaries
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
          score: c.score,
          publish_date: dateStr,
          featured: isFeatured,
        });

        L(`Scheduled: "${summaries.title_en}" at ${dateStr}${isFeatured ? " ⭐ FEATURED" : ""} (score: ${c.score})`);
        scheduleCursor = nextSlot(scheduleCursor, intervalMinutes);
      } catch (err) {
        L(`Error processing "${c.title}": ${err}`);
      }
    }

    // Export rejection log
    try { await exportRejections(); } catch { /* ok */ }

    L(`Done — ${results.length} articles scheduled`);

    return Response.json({
      ok: true,
      selected: results.length,
      filtered: totalFiltered,
      skipped: totalSkipped,
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
