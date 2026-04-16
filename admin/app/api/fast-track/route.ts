/**
 * Fast-Track Pipeline
 *
 * Orchestrates the full article pipeline in a single streaming request:
 *   1. Fetch all active RSS sources
 *   2. Filter with maximum positivity strictness (threshold = 10)
 *   3. Auto-approve every article that passes
 *   4. Summarise (EN / NL / FR titles + summaries, emoji, tags)
 *   5. Publish to GitHub → triggers site rebuild
 *
 * Streams NDJSON progress events so the UI can show live updates.
 */

import { NextRequest } from "next/server";
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

// ─── Publisher ────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/-$/, "");
}

function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function generateMarkdown(article: Record<string, unknown>, tagNames: string[]): string {
  const title = String(article.title_en ?? article.title_nl ?? "Untitled");
  const rawDate = article.published_at ?? article.publish_date;
  const date = rawDate
    ? String(rawDate).slice(0, 19).replace(" ", "T")
    : new Date().toISOString().slice(0, 19);

  const sourcePubDate = article.source_pub_date
    ? String(article.source_pub_date).slice(0, 10)
    : null;
  const fetchedDate = article.fetched_at
    ? String(article.fetched_at).slice(0, 10)
    : null;

  const primaryTag = tagNames[0] ?? "";
  const emoji = String(article.article_emoji ?? "📰");

  return [
    `---`,
    `title: ${yamlStr(title)}`,
    `title_nl: ${yamlStr(String(article.title_nl ?? title))}`,
    `title_fr: ${yamlStr(String(article.title_fr ?? title))}`,
    `date: ${date}`,
    ...(sourcePubDate ? [`source_pub_date: ${sourcePubDate}`] : []),
    ...(fetchedDate   ? [`fetched_date: ${fetchedDate}`]      : []),
    `source_url: ${yamlStr(String(article.source_url))}`,
    `source_name: ${yamlStr(String(article.source_name))}`,
    `topic: ${yamlStr(primaryTag)}`,
    `tags: ${JSON.stringify(tagNames)}`,
    `emoji: ${yamlStr(emoji)}`,
    `summary: ${yamlStr(String(article.summary_en ?? ""))}`,
    `summary_nl: ${yamlStr(String(article.summary_nl ?? ""))}`,
    `summary_fr: ${yamlStr(String(article.summary_fr ?? ""))}`,
    ...(article.image_url ? [`image_url: ${yamlStr(String(article.image_url))}`] : []),
    `layout: post.njk`,
    `---`,
    ``,
    String(article.summary_en ?? ""),
  ].join("\n");
}

async function commitToGitHub(path: string, content: string, message: string) {
  const GITHUB_TOKEN  = process.env.GITHUB_TOKEN!;
  const GITHUB_REPO   = process.env.GITHUB_REPO!;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";

  const encoded = Buffer.from(content).toString("base64");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;

  let sha: string | undefined;
  const existing = await fetch(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (existing.ok) sha = (await existing.json()).sha;

  const body: Record<string, unknown> = { message, content: encoded, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
}

// ─── Schedule-mode helpers ────────────────────────────────────────────────────

function nextSlot(after: Date, intervalMinutes: number, bufferMinutes = 2): Date {
  const t = new Date(after.getTime() + bufferMinutes * 60 * 1000);
  const totalMins = t.getHours() * 60 + t.getMinutes();
  const rounded = Math.ceil(totalMins / intervalMinutes) * intervalMinutes;
  const result = new Date(t);
  result.setHours(Math.floor(rounded / 60), rounded % 60, 0, 0);
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

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  // mode: "publish" (default) → commit to GitHub immediately
  // mode: "schedule" → assign staggered publish_date, leave in queue
  const mode: "publish" | "schedule" = body.mode === "schedule" ? "schedule" : "publish";
  const intervalMinutes: number = Math.max(5, Number(body.interval_minutes) || 30);

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO  = process.env.GITHUB_REPO;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        } catch { /* stream already closed */ }
      };

      if (mode === "publish" && (!GITHUB_TOKEN || !GITHUB_REPO)) {
        send({ type: "fatal", message: "GITHUB_TOKEN and GITHUB_REPO must be set in .env.local" });
        controller.close();
        return;
      }

      try {
        const sourcesResult = await db.execute(
          "SELECT * FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss')"
        );
        const sources = sourcesResult.rows;

        // Always use maximum strictness for fast-track
        const filterInstructions = buildFilterInstructions(10);

        const settings = await getSettings();
        const style = settings.summarise_style_override || DEFAULT_SUMMARISE_STYLE;

        // Load all available tags once
        const tagsResult = await db.execute("SELECT id, name, emoji FROM topics ORDER BY name ASC");
        const availableTags: TagRow[] = tagsResult.rows.map((t) => ({
          id: Number(t.id),
          name: String(t.name),
          emoji: String(t.emoji),
        }));
        const tagNameMap = new Map(availableTags.map((t) => [t.name.toLowerCase(), t]));

        // In schedule mode: find latest existing slot, chain after it
        let scheduleCursor: Date | null = null;
        if (mode === "schedule") {
          const latestResult = await db.execute(`
            SELECT MAX(publish_date) as latest FROM articles
            WHERE status = 'scheduled' AND publish_date IS NOT NULL AND publish_date != ''
          `);
          const latestRaw = latestResult.rows[0]?.latest as string | null;
          const latestExisting = latestRaw ? new Date(latestRaw) : null;
          const now = new Date();
          const startAfter = latestExisting && latestExisting > now ? latestExisting : now;
          scheduleCursor = nextSlot(startAfter, intervalMinutes);
        }

        send({ type: "start", totalSources: sources.length, mode });

        let totalPassed = 0, totalFiltered = 0, totalSkipped = 0, totalPublished = 0, totalErrors = 0;

        for (const source of sources) {
          const feedUrl = (source.feed_url ?? source.url) as string;
          send({ type: "source", name: source.name as string, url: feedUrl });

          let passed = 0, filtered = 0, skipped = 0, published = 0, errors = 0;

          try {
            const feed = await parser.parseURL(feedUrl);
            const items = feed.items.slice(0, 20).filter((i) => i.link && i.title);

            for (const item of items) {
              const [existingRaw, existingRejected] = await Promise.all([
                db.execute({ sql: "SELECT id FROM raw_articles WHERE url = ?", args: [item.link!] }),
                db.execute({ sql: "SELECT id FROM rejected_articles WHERE url = ?", args: [item.link!] }),
              ]);

              if (existingRaw.rows.length > 0 || existingRejected.rows.length > 0) {
                skipped++;
                continue;
              }

              const snippet = item.contentSnippet ?? item.content ?? "";
              const sourcePubDate = item.isoDate
                ? item.isoDate.slice(0, 10)
                : item.pubDate
                ? new Date(item.pubDate).toISOString().slice(0, 10)
                : null;

              // ── Step 1: Positivity filter (threshold 10) ──
              const { fits, reason, category, score } = await checkPositivity(
                item.title!,
                snippet,
                filterInstructions,
              );

              if (!fits) {
                filtered++;
                send({ type: "article", verdict: "filtered", title: item.title!, reason, category, score });
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

              // ── Step 2: Insert into raw_articles ──
              passed++;
              send({ type: "article", verdict: "passed", title: item.title!, score });

              let rawId: number;
              try {
                const rawInsert = await db.execute({
                  sql: "INSERT INTO raw_articles (source_id, url, title, content, source_pub_date) VALUES (?, ?, ?, ?, ?)",
                  args: [source.id, item.link!, item.title!, snippet, sourcePubDate],
                });
                rawId = Number(rawInsert.lastInsertRowid);
              } catch (err) {
                errors++;
                send({ type: "article", verdict: "error", title: item.title!, step: "insert-raw", message: String(err) });
                continue;
              }

              // ── Step 3: Auto-approve → create articles record ──
              let articleId: number;
              try {
                const approveInsert = await db.execute({
                  sql: `INSERT OR IGNORE INTO articles (raw_article_id, source_url, source_name, status, positivity_score)
                        VALUES (?, ?, ?, 'draft', ?)`,
                  args: [rawId, item.link!, source.name as string, score ?? null],
                });
                articleId = Number(approveInsert.lastInsertRowid);
                await db.execute({ sql: "UPDATE raw_articles SET status = 'approved' WHERE id = ?", args: [rawId] });
              } catch (err) {
                errors++;
                send({ type: "article", verdict: "error", title: item.title!, step: "approve", message: String(err) });
                continue;
              }

              // ── Step 4: Fetch full content + Summarise ──
              let summaries: Awaited<ReturnType<typeof summariseAndTranslate>>;
              let imageUrl: string | null = null;
              try {
                send({ type: "article", verdict: "summarising", title: item.title! });
                const { text: articleText, imageUrl: img } = await fetchArticleContent(item.link!);
                imageUrl = img;

                summaries = await summariseAndTranslate(
                  articleText,
                  item.link!,
                  source.name as string,
                  item.title!,
                  availableTags,
                  style,
                );

                await db.execute({
                  sql: `UPDATE articles SET
                          title_nl = ?, title_fr = ?, title_en = ?,
                          summary_nl = ?, summary_fr = ?, summary_en = ?,
                          article_emoji = ?, image_url = ?, status = 'scheduled'
                        WHERE id = ?`,
                  args: [
                    summaries.title_nl, summaries.title_fr, summaries.title_en,
                    summaries.summary_nl, summaries.summary_fr, summaries.summary_en,
                    summaries.emoji, imageUrl, articleId,
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
              } catch (err) {
                errors++;
                send({ type: "article", verdict: "error", title: item.title!, step: "summarise", message: String(err) });
                continue;
              }

              // ── Step 5: Publish to GitHub OR schedule ──
              if (mode === "schedule") {
                // Assign staggered publish_date and leave in queue
                try {
                  const dateStr = toLocalISO(scheduleCursor!);
                  await db.execute({
                    sql: "UPDATE articles SET publish_date = ? WHERE id = ?",
                    args: [dateStr, articleId],
                  });
                  published++; // reuse counter — means "scheduled" in this mode
                  send({ type: "article", verdict: "scheduled", title: summaries.title_en, publish_date: dateStr });
                  scheduleCursor = new Date(scheduleCursor!.getTime() + intervalMinutes * 60 * 1000);
                } catch (err) {
                  errors++;
                  send({ type: "article", verdict: "error", title: item.title!, step: "schedule", message: String(err) });
                }
              } else {
                // Publish immediately to GitHub
                try {
                  send({ type: "article", verdict: "publishing", title: summaries.title_en });

                  const articleResult = await db.execute({
                    sql: `SELECT a.*, r.source_pub_date, r.fetched_at
                          FROM articles a
                          LEFT JOIN raw_articles r ON a.raw_article_id = r.id
                          WHERE a.id = ?`,
                    args: [articleId],
                  });
                  const articleRow = articleResult.rows[0] as Record<string, unknown>;

                  const tagsForArticle = await db.execute({
                    sql: `SELECT t.name FROM article_tags at2
                          JOIN topics t ON at2.tag_id = t.id
                          WHERE at2.article_id = ?
                          ORDER BY t.name ASC`,
                    args: [articleId],
                  });
                  const tagNames = tagsForArticle.rows.map((r) => String(r.name));

                  const date = new Date().toISOString().slice(0, 10);
                  const path = `site/src/posts/${date}-${slugify(summaries.title_en)}.md`;

                  const markdown = generateMarkdown({ ...articleRow, image_url: imageUrl }, tagNames);
                  await commitToGitHub(path, markdown, `Add post: ${summaries.title_en}`);

                  await db.execute({
                    sql: "UPDATE articles SET status = 'published', published_at = datetime('now'), published_path = ? WHERE id = ?",
                    args: [path, articleId],
                  });

                  published++;
                  send({ type: "article", verdict: "published", title: summaries.title_en, path });
                } catch (err) {
                  errors++;
                  send({ type: "article", verdict: "error", title: item.title!, step: "publish", message: String(err) });
                }
              }
            }

            send({
              type: "source_done",
              name: source.name as string,
              passed, filtered, skipped, published, errors,
            });
          } catch (err) {
            send({ type: "source_error", name: source.name as string, message: String(err) });
          }

          totalPassed     += passed;
          totalFiltered   += filtered;
          totalSkipped    += skipped;
          totalPublished  += published;
          totalErrors     += errors;
        }

        send({
          type: "done",
          mode,
          passed: totalPassed,
          filtered: totalFiltered,
          skipped: totalSkipped,
          published: totalPublished,
          errors: totalErrors,
        });

        // Export rejection log
        try {
          send({ type: "exporting" });
          const { exported } = await exportRejections();
          send({ type: "exported", count: exported });
        } catch (err) {
          send({ type: "export_error", message: String(err) });
        }
      } catch (err) {
        send({ type: "fatal", message: String(err) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
