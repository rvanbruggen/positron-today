import { NextRequest } from "next/server";
import db from "@/lib/db";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

async function getManualSourceId(): Promise<number> {
  const existing = await db.execute(
    "SELECT id FROM sources WHERE name = 'Manual' LIMIT 1"
  );
  if (existing.rows.length > 0) return Number(existing.rows[0].id);

  const result = await db.execute({
    sql: "INSERT INTO sources (name, url, type, language) VALUES (?, ?, ?, ?) RETURNING id",
    args: ["Manual", "https://manual.positiviteiten", "website", "en"],
  });
  return Number(result.rows[0].id);
}

async function fetchPageInfo(url: string): Promise<{ title: string; content: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Positiviteiten/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    const html = await res.text();

    // Try og:title / <title> as fallback title sources
    const titleMatch =
      html.match(/property="og:title"\s+content="([^"]+)"/i) ||
      html.match(/content="([^"]+)"\s+property="og:title"/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i);

    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();

    const title =
      article?.title ||
      (titleMatch ? titleMatch[1].trim() : "") ||
      url;
    const content =
      (article?.textContent?.trim().length ?? 0) > 200
        ? (article?.textContent?.slice(0, 4000) ?? "")
        : "";

    return { title, content };
  } catch {
    return { title: url, content: "" };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url) return Response.json({ error: "url required" }, { status: 400 });

    try {
      new URL(url);
    } catch {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Check if already in database
    const existing = await db.execute({
      sql: "SELECT id FROM raw_articles WHERE url = ?",
      args: [url],
    });
    if (existing.rows.length > 0) {
      return Response.json(
        { error: "This URL is already in the queue" },
        { status: 409 }
      );
    }

    // Fetch page content (no AI filter - user manually chose this URL)
    const { title, content } = await fetchPageInfo(url);

    // Get or create the "Manual" source
    const sourceId = await getManualSourceId();

    await db.execute({
      sql: "INSERT INTO raw_articles (source_id, url, title, content) VALUES (?, ?, ?, ?)",
      args: [sourceId, url, title, content],
    });

    return Response.json({ added: true, title });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
