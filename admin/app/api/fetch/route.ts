import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";
import RSSParser from "rss-parser";
import Anthropic from "@anthropic-ai/sdk";

const parser = new RSSParser();
const anthropic = new Anthropic();

async function checkPositivity(
  title: string,
  snippet: string
): Promise<{ fits: boolean; reason: string }> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 80,
    messages: [
      {
        role: "user",
        content: `You are a filter for "Positiviteiten", a positive-news website.

A good fit: genuinely good news, heartwarming stories, scientific breakthroughs, environmental wins, funny/lighthearted stories, inspiring achievements — anything that leaves the reader feeling better.

NOT a good fit: crime, war, political conflict, disasters, economic doom, health scares, or predominantly negative/anxiety-inducing stories — even with a small positive angle.

Article title: ${title}
Snippet: ${snippet}

Reply with JSON only — no other text:
{"verdict":"YES"} if it fits, or {"verdict":"NO","reason":"reason in 10 words or fewer"} if not.`,
      },
    ],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();
  try {
    const parsed = JSON.parse(raw);
    return { fits: parsed.verdict === "YES", reason: parsed.reason ?? "" };
  } catch {
    return { fits: raw.toUpperCase().startsWith("YES"), reason: "" };
  }
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
                continue; // don't log individual skips — too noisy
              }

              const snippet = item.contentSnippet ?? item.content ?? "";
              const { fits, reason } = await checkPositivity(item.title!, snippet);

              if (!fits) {
                filtered++;
                send({ type: "article", verdict: "filtered", title: item.title!, reason });
                try {
                  await db.execute({
                    sql: `INSERT OR IGNORE INTO rejected_articles
                          (source_id, source_name, url, title, snippet, rejection_reason)
                          VALUES (?, ?, ?, ?, ?, ?)`,
                    args: [source.id, source.name as string, item.link!, item.title!, snippet.slice(0, 500), reason],
                  });
                } catch { /* duplicate */ }
              } else {
                await db.execute({
                  sql: "INSERT INTO raw_articles (source_id, url, title, content) VALUES (?, ?, ?, ?)",
                  args: [source.id, item.link!, item.title!, snippet],
                });
                added++;
                send({ type: "article", verdict: "added", title: item.title! });
              }
            }
          } catch (err) {
            send({ type: "source_error", name: source.name as string, message: String(err) });
          }

          send({ type: "source_done", name: source.name as string, added, filtered, skipped });
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
