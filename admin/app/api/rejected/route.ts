import { NextRequest } from "next/server";
import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";

export async function GET() {
  const result = await db.execute(`
    SELECT id, source_name, url, title, snippet, rejection_reason, rejection_category, fetched_at, source_pub_date
    FROM rejected_articles
    ORDER BY fetched_at DESC
    LIMIT 500
  `);
  return Response.json(result.rows);
}

// Override: approve a rejected article (moves it into raw_articles as pending)
export async function POST(request: NextRequest) {
  const { id } = await request.json();
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const result = await db.execute({
    sql: "SELECT * FROM rejected_articles WHERE id = ?",
    args: [id],
  });
  const article = result.rows[0];
  if (!article) return Response.json({ error: "Not found" }, { status: 404 });

  // Check not already in raw_articles
  const existing = await db.execute({
    sql: "SELECT id FROM raw_articles WHERE url = ?",
    args: [article.url as string],
  });
  if (existing.rows.length > 0) {
    return Response.json({ error: "Already in review queue" }, { status: 409 });
  }

  await db.execute({
    sql: "INSERT INTO raw_articles (source_id, url, title, content) VALUES (?, ?, ?, ?)",
    args: [article.source_id, article.url as string, article.title as string, article.snippet ?? ""],
  });

  // Remove from rejected so it doesn't show as both
  await db.execute({ sql: "DELETE FROM rejected_articles WHERE id = ?", args: [id] });

  // Keep the public rejection log in sync — fire and forget, don't block the response
  exportRejections().catch(err => console.error("Export after override failed:", err));

  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await db.execute({ sql: "DELETE FROM rejected_articles WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
