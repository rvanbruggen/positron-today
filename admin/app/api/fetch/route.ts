import db from "@/lib/db";
import RSSParser from "rss-parser";
import Anthropic from "@anthropic-ai/sdk";

const parser = new RSSParser();
const anthropic = new Anthropic();

async function isPositive(title: string, snippet: string): Promise<boolean> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 10,
    messages: [
      {
        role: "user",
        content: `You are a filter for a website called "Positiviteiten" that only publishes positive, uplifting, or funny news. Your job is to decide if an article is a good fit.

A good fit is: genuinely good news, a heartwarming story, a scientific breakthrough, an environmental win, a funny/lighthearted story, an inspiring human achievement, or anything that leaves the reader feeling better.

NOT a good fit: crime, war, political conflict, disasters, economic doom, health scares, or any story with a predominantly negative or anxiety-inducing tone — even if it has a small positive angle.

Article title: ${title}
Snippet: ${snippet}

Reply with exactly one word: YES or NO.`,
      },
    ],
  });

  const reply = (message.content[0] as { type: string; text: string }).text.trim().toUpperCase();
  return reply === "YES";
}

export async function POST() {
  const sourcesResult = await db.execute(
    "SELECT * FROM sources WHERE active = 1 AND type = 'rss'"
  );

  let added = 0;
  let filtered = 0;
  let skipped = 0;

  for (const source of sourcesResult.rows) {
    try {
      const feed = await parser.parseURL(source.url as string);
      for (const item of feed.items.slice(0, 20)) {
        if (!item.link || !item.title) continue;

        // Skip articles already in the database
        const existing = await db.execute({
          sql: "SELECT id FROM raw_articles WHERE url = ?",
          args: [item.link],
        });
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        const snippet = item.contentSnippet ?? item.content ?? "";

        // Pre-filter with Claude
        const fits = await isPositive(item.title, snippet);
        if (!fits) {
          filtered++;
          continue;
        }

        await db.execute({
          sql: "INSERT INTO raw_articles (source_id, url, title, content) VALUES (?, ?, ?, ?)",
          args: [source.id, item.link, item.title, snippet],
        });
        added++;
      }
    } catch (err) {
      console.error(`Failed to fetch source ${source.name}:`, err);
    }
  }

  return Response.json({ added, filtered, skipped });
}
