/**
 * Preview route for comparing Instagram card generators.
 * GET /api/instagram-card-preview?id=222&engine=og
 *   engine=og      → @vercel/og (new, portable)
 *   engine=python   → Python/Playwright (current)
 *   engine=both     → returns HTML page with both side by side
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { generateInstagramCardOg } from "@/lib/instagram-card-og";
import { generateInstagramCardPng } from "@/lib/instagram-card";

async function getArticle(id: string) {
  const result = await db.execute({
    sql: `SELECT title_en, title_nl, article_emoji, source_name, image_url
          FROM articles WHERE id = ?`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    title:    String(row.title_en ?? row.title_nl ?? ""),
    emoji:    String(row.article_emoji ?? "✨"),
    source:   String(row.source_name ?? ""),
    imageUrl: row.image_url ? String(row.image_url) : null,
  };
}

export async function GET(req: NextRequest) {
  const id     = req.nextUrl.searchParams.get("id");
  const engine = req.nextUrl.searchParams.get("engine") ?? "both";

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const article = await getArticle(id);
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  if (engine === "og") {
    const png = await generateInstagramCardOg(article);
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png" },
    });
  }

  if (engine === "python") {
    const png = await generateInstagramCardPng(article);
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png" },
    });
  }

  // engine=both → side-by-side comparison HTML
  return new NextResponse(
    `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Instagram Card Comparison — ${article.title}</title>
<style>
  body { font-family: system-ui; background: #1a1a1a; color: #eee; padding: 40px; margin: 0; }
  h1 { font-size: 20px; color: #fbbf24; margin-bottom: 8px; }
  p { font-size: 14px; color: #999; margin-bottom: 30px; }
  .grid { display: flex; gap: 40px; flex-wrap: wrap; }
  .card { text-align: center; }
  .card h2 { font-size: 14px; color: #d97706; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.1em; }
  .card img { width: 540px; height: 540px; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.5); }
</style>
</head><body>
<h1>${article.emoji} ${article.title}</h1>
<p>Source: ${article.source} · Article ID: ${id}</p>
<div class="grid">
  <div class="card">
    <h2>Current (Python / Playwright)</h2>
    <img src="/api/instagram-card-preview?id=${id}&engine=python" alt="Python card">
  </div>
  <div class="card">
    <h2>New (@vercel/og)</h2>
    <img src="/api/instagram-card-preview?id=${id}&engine=og" alt="OG card">
  </div>
</div>
</body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
