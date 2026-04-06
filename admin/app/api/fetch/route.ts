import db from "@/lib/db";
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
    // Fallback: treat as YES/NO plain text
    return { fits: raw.toUpperCase().startsWith("YES"), reason: "" };
  }
}

export async function POST() {
  // Fetch all active sources that have either a feed_url or are type='rss'
  const sourcesResult = await db.execute(
    "SELECT * FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss')"
  );

  let added = 0;
  let filtered = 0;
  let skipped = 0;

  for (const source of sourcesResult.rows) {
    // Use feed_url if set, otherwise fall back to url (legacy rss type)
    const feedUrl = (source.feed_url ?? source.url) as string;
    try {
      const feed = await parser.parseURL(feedUrl);
      for (const item of feed.items.slice(0, 20)) {
        if (!item.link || !item.title) continue;

        // Skip if already seen (either pending/approved/discarded or previously rejected)
        const [existingRaw, existingRejected] = await Promise.all([
          db.execute({ sql: "SELECT id FROM raw_articles WHERE url = ?", args: [item.link] }),
          db.execute({ sql: "SELECT id FROM rejected_articles WHERE url = ?", args: [item.link] }),
        ]);
        if (existingRaw.rows.length > 0 || existingRejected.rows.length > 0) {
          skipped++;
          continue;
        }

        const snippet = item.contentSnippet ?? item.content ?? "";
        const { fits, reason } = await checkPositivity(item.title, snippet);

        if (!fits) {
          filtered++;
          // Store in rejection log with the reason
          try {
            await db.execute({
              sql: `INSERT OR IGNORE INTO rejected_articles
                    (source_id, source_name, url, title, snippet, rejection_reason)
                    VALUES (?, ?, ?, ?, ?, ?)`,
              args: [
                source.id,
                source.name as string,
                item.link,
                item.title,
                snippet.slice(0, 500),
                reason,
              ],
            });
          } catch { /* duplicate url — fine */ }
          continue;
        }

        await db.execute({
          sql: "INSERT INTO raw_articles (source_id, url, title, content) VALUES (?, ?, ?, ?)",
          args: [source.id, item.link, item.title, snippet],
        });
        added++;
      }
    } catch (err) {
      console.error(`Failed to fetch source ${source.name as string}:`, err);
    }
  }

  return Response.json({ added, filtered, skipped });
}
