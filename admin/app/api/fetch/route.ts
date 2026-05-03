import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";
import { getFilterProvider } from "@/lib/llm";
import { buildFilterInstructions, buildFilterPrompt } from "@/lib/prompts";
import { getSettings } from "@/lib/settings";
import { CATEGORY_SLUGS } from "@/lib/rejection-categories";
import { isNativeOutputLanguage } from "@/lib/languages";
import RSSParser from "rss-parser";

// 8s per-feed timeout: a single hanging RSS host used to eat the whole
// 60s Vercel budget. rss-parser has no default timeout.
const parser = new RSSParser({ timeout: 8000 });

async function checkPositivity(
  title: string,
  snippet: string,
  filterInstructions: string,
  translateToEnglish: boolean,
): Promise<{
  fits: boolean;
  reason: string;
  category: string;
  score?: number;
  preview_title_en?: string;
  preview_snippet_en?: string;
}> {
  const provider = await getFilterProvider();
  const prompt = buildFilterPrompt(filterInstructions, title, snippet, translateToEnglish);
  const result = await provider.classify(prompt);
  return {
    fits: result.fits,
    reason: result.reason,
    category: result.category ?? "other-negative",
    score: result.score,
    preview_title_en: result.preview_title_en,
    preview_snippet_en: result.preview_snippet_en,
  };
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  const isAuto = url.searchParams.get("auto") === "1";

  // When called with ?auto=1 (from Synology cron), only run if Positronitron
  // is in a mode that fetches (fetch, summarise, full).
  if (isAuto) {
    const settings = await getSettings();
    if (settings.positronitron_mode === "off") {
      return Response.json({ skipped: true, message: "Positronitron is off. Skipping auto-fetch." });
    }
  }

  // In auto mode, rotate through source chunks automatically.
  // Each call processes 10 sources, then saves the next offset for the next call.
  let offset: number;
  // Default chunk size of 5 (was 10) so each invocation comfortably fits
  // under Vercel's 60s Hobby-tier maxDuration. The auto-offset wraps, so
  // smaller chunks just mean more cron ticks per full cycle.
  const limit = Math.max(1, parseInt(url.searchParams.get("limit") ?? "5"));

  if (isAuto) {
    const offsetResult = await db.execute({
      sql: "SELECT value FROM settings WHERE key = 'auto_fetch_offset'",
      args: [],
    });
    offset = parseInt(String(offsetResult.rows[0]?.value ?? "0"), 10) || 0;
  } else {
    offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0"));
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        } catch { /* stream already closed */ }
      };

      try {
        const allSourcesResult = await db.execute(
          "SELECT * FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss') ORDER BY id ASC"
        );
        const totalSources = allSourcesResult.rows.length;
        const sources = allSourcesResult.rows.slice(offset, offset + limit);

        send({ type: "start", totalSources, chunkSize: sources.length, offset, hasMore: offset + limit < totalSources });

        // Read prompt settings once for the entire run
        const settings = await getSettings();
        const filterInstructions = settings.filter_prompt_override ||
          buildFilterInstructions(parseInt(settings.filter_threshold) || 5);

        let totalAdded = 0, totalFiltered = 0, totalSkipped = 0;

        for (const source of sources) {
          const feedUrl = (source.feed_url ?? source.url) as string;
          send({ type: "source", name: source.name as string, url: feedUrl });

          let added = 0, filtered = 0, skipped = 0;

          try {
            const feed = await parser.parseURL(feedUrl);
            // Cap at 10 items per feed (was 20). Most healthy feeds only have
            // a handful of new items per cycle anyway, and the LLM classify
            // call dominates per-item cost.
            const items = feed.items.slice(0, 10).filter(i => i.link && i.title);

            for (const item of items) {
              const [existingRaw, existingRejected, existingArticle] = await Promise.all([
                db.execute({ sql: "SELECT id FROM raw_articles WHERE url = ?", args: [item.link!] }),
                db.execute({ sql: "SELECT id FROM rejected_articles WHERE url = ?", args: [item.link!] }),
                db.execute({ sql: "SELECT id FROM articles WHERE source_url = ?", args: [item.link!] }),
              ]);

              if (existingRaw.rows.length > 0 || existingRejected.rows.length > 0 || existingArticle.rows.length > 0) {
                skipped++;
                continue;
              }

              const snippet = item.contentSnippet ?? item.content ?? "";

              // Capture the original publication date from the RSS item (used for both paths)
              const sourcePubDate = item.isoDate
                ? item.isoDate.slice(0, 10)
                : item.pubDate
                ? new Date(item.pubDate).toISOString().slice(0, 10)
                : null;

              const needsTranslation = !isNativeOutputLanguage(source.language as string);
              const { fits, reason, category, score, preview_title_en, preview_snippet_en } =
                await checkPositivity(item.title!, snippet, filterInstructions, needsTranslation);

              if (!fits) {
                filtered++;
                send({ type: "article", verdict: "filtered", title: item.title!, reason, category, score });
                // Validate category slug
                const safeCategory = CATEGORY_SLUGS.includes(category) ? category : "other-negative";
                try {
                  await db.execute({
                    sql: `INSERT OR IGNORE INTO rejected_articles
                          (source_id, source_name, url, title, snippet, rejection_reason, rejection_category, source_pub_date)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [source.id, source.name as string, item.link!, item.title!, snippet.slice(0, 500), reason, safeCategory, sourcePubDate],
                  });
                } catch { /* duplicate */ }
              } else {
                await db.execute({
                  sql: `INSERT INTO raw_articles
                          (source_id, url, title, content, source_pub_date, positivity_score,
                           preview_title_en, preview_snippet_en)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  args: [
                    source.id, item.link!, item.title!, snippet, sourcePubDate, score ?? null,
                    preview_title_en ?? null, preview_snippet_en ?? null,
                  ],
                });
                added++;
                send({ type: "article", verdict: "added", title: item.title!, score });
              }
            }
            send({ type: "source_done", name: source.name as string, added, filtered, skipped });
          } catch (err) {
            send({ type: "source_error", name: source.name as string, message: String(err) });
          }
          totalAdded += added;
          totalFiltered += filtered;
          totalSkipped += skipped;
        }

        const hasMore = offset + limit < totalSources;
        const nextOffset = hasMore ? offset + limit : 0; // wrap around to 0 when done
        send({ type: "done", added: totalAdded, filtered: totalFiltered, skipped: totalSkipped, hasMore, nextOffset });

        // In auto mode, save the next offset for the next cron call
        if (isAuto) {
          await db.execute({
            sql: `INSERT INTO settings (key, value) VALUES ('auto_fetch_offset', ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            args: [String(nextOffset)],
          });
        }

        // Auto-publish rejection log only on the last chunk
        if (!hasMore) {
          try {
            send({ type: "exporting" });
            const { exported } = await exportRejections();
            send({ type: "exported", count: exported });
          } catch (err) {
            send({ type: "export_error", message: String(err) });
          }
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
