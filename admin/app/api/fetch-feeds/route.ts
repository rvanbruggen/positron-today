import db from "@/lib/db";
import { getSettings } from "@/lib/settings";
import RSSParser from "rss-parser";

// Phase 1 of the two-phase fetch pipeline. Pulls RSS items, dedups against
// raw_articles / rejected_articles / articles, and inserts new items into
// pending_items for /api/classify to drain via the LLM. No LLM calls here,
// so each invocation comfortably fits Vercel's 60s budget even with many
// sources per chunk.

const parser = new RSSParser({ timeout: 8000 });

export async function POST(request: Request) {
  const url = new URL(request.url);
  const isAuto = url.searchParams.get("auto") === "1";

  if (isAuto) {
    const settings = await getSettings();
    if (settings.positronitron_mode === "off") {
      return Response.json({ skipped: true, message: "Positronitron is off. Skipping auto-fetch." });
    }
  }

  // Larger default chunk than the legacy /api/fetch (which had to share its
  // 60s budget with LLM calls). Phase 1 is ~1-2s per feed worst-case, so 15
  // sources fit comfortably.
  const limit = Math.max(1, parseInt(url.searchParams.get("limit") ?? "15"));

  let offset: number;
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

        send({
          type: "start",
          phase: "fetch-feeds",
          totalSources,
          chunkSize: sources.length,
          offset,
          hasMore: offset + limit < totalSources,
        });

        let totalQueued = 0, totalSkipped = 0;

        for (const source of sources) {
          const feedUrl = (source.feed_url ?? source.url) as string;
          send({ type: "source", name: source.name as string, url: feedUrl });

          let queued = 0, skipped = 0;

          try {
            const feed = await parser.parseURL(feedUrl);
            const items = feed.items.slice(0, 10).filter(i => i.link && i.title);

            for (const item of items) {
              // Dedup against everything: already-pending, raw, rejected, published.
              const [existingPending, existingRaw, existingRejected, existingArticle] = await Promise.all([
                db.execute({ sql: "SELECT id FROM pending_items WHERE url = ?", args: [item.link!] }),
                db.execute({ sql: "SELECT id FROM raw_articles WHERE url = ?", args: [item.link!] }),
                db.execute({ sql: "SELECT id FROM rejected_articles WHERE url = ?", args: [item.link!] }),
                db.execute({ sql: "SELECT id FROM articles WHERE source_url = ?", args: [item.link!] }),
              ]);

              if (
                existingPending.rows.length > 0 ||
                existingRaw.rows.length > 0 ||
                existingRejected.rows.length > 0 ||
                existingArticle.rows.length > 0
              ) {
                skipped++;
                continue;
              }

              const snippet = item.contentSnippet ?? item.content ?? "";
              const sourcePubDate = item.isoDate
                ? item.isoDate.slice(0, 10)
                : item.pubDate
                ? new Date(item.pubDate).toISOString().slice(0, 10)
                : null;

              try {
                await db.execute({
                  sql: `INSERT INTO pending_items
                          (source_id, url, title, snippet, source_pub_date)
                        VALUES (?, ?, ?, ?, ?)`,
                  args: [source.id, item.link!, item.title!, snippet, sourcePubDate],
                });
                queued++;
                send({ type: "item", verdict: "queued", title: item.title! });
              } catch { /* duplicate slipped past dedup, ignore */ }
            }

            send({ type: "source_done", name: source.name as string, queued, skipped });
          } catch (err) {
            send({ type: "source_error", name: source.name as string, message: String(err) });
          }
          totalQueued += queued;
          totalSkipped += skipped;
        }

        const hasMore = offset + limit < totalSources;
        const nextOffset = hasMore ? offset + limit : 0;

        // Report current queue depth so the UI / cron knows what classify has to do.
        const queueDepthResult = await db.execute("SELECT COUNT(*) AS c FROM pending_items");
        const queueDepth = Number(queueDepthResult.rows[0]?.c ?? 0);

        send({
          type: "done",
          phase: "fetch-feeds",
          queued: totalQueued,
          skipped: totalSkipped,
          hasMore,
          nextOffset,
          queueDepth,
        });

        if (isAuto) {
          await db.execute({
            sql: `INSERT INTO settings (key, value) VALUES ('auto_fetch_offset', ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            args: [String(nextOffset)],
          });
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
