import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";
import { getFilterProvider } from "@/lib/llm";
import { buildFilterInstructions, buildFilterPrompt } from "@/lib/prompts";
import { getSettings } from "@/lib/settings";
import { CATEGORY_SLUGS } from "@/lib/rejection-categories";
import RSSParser from "rss-parser";

const parser = new RSSParser();

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

export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        } catch { /* stream already closed */ }
      };

      try {
        const sourcesResult = await db.execute(
          "SELECT * FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss')"
        );
        const sources = sourcesResult.rows;

        send({ type: "start", totalSources: sources.length });

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
            const items = feed.items.slice(0, 20).filter(i => i.link && i.title);

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

              // Capture the original publication date from the RSS item (used for both paths)
              const sourcePubDate = item.isoDate
                ? item.isoDate.slice(0, 10)
                : item.pubDate
                ? new Date(item.pubDate).toISOString().slice(0, 10)
                : null;

              const { fits, reason, category, score } = await checkPositivity(item.title!, snippet, filterInstructions);

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
                  sql: "INSERT INTO raw_articles (source_id, url, title, content, source_pub_date, positivity_score) VALUES (?, ?, ?, ?, ?, ?)",
                  args: [source.id, item.link!, item.title!, snippet, sourcePubDate, score ?? null],
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

        send({ type: "done", added: totalAdded, filtered: totalFiltered, skipped: totalSkipped });

        // Auto-publish rejection log to the public site
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
