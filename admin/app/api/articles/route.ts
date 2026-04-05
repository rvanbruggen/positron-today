import { NextRequest } from "next/server";
import db from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "pending";

  const result = await db.execute({
    sql: `SELECT r.*, s.name as source_name
          FROM raw_articles r
          JOIN sources s ON r.source_id = s.id
          WHERE r.status = ?
          ORDER BY r.fetched_at DESC`,
    args: [status],
  });
  return Response.json(result.rows);
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, status, publish_date, topic_id, reset_to_draft } = body;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Reset a published article back to draft for re-summarisation
  if (reset_to_draft) {
    await db.execute({
      sql: `UPDATE articles SET status = 'draft',
              title_en = NULL, title_nl = NULL, title_fr = NULL,
              summary_en = NULL, summary_nl = NULL, summary_fr = NULL,
              published_at = NULL
            WHERE id = ?`,
      args: [id],
    });
    return Response.json({ ok: true });
  }

  if (publish_date !== undefined) {
    await db.execute({
      sql: "UPDATE articles SET publish_date = ? WHERE id = ?",
      args: [publish_date, id],
    });
    return Response.json({ ok: true });
  }

  if (topic_id !== undefined) {
    await db.execute({
      sql: "UPDATE articles SET topic_id = ? WHERE id = ?",
      args: [topic_id === null ? null : Number(topic_id), id],
    });
    return Response.json({ ok: true });
  }

  if (!status) return Response.json({ error: "id and status required" }, { status: 400 });

  await db.execute({
    sql: "UPDATE raw_articles SET status = ? WHERE id = ?",
    args: [status, id],
  });

  // When approved, create a draft article record ready for summarisation
  if (status === "approved") {
    const rawResult = await db.execute({
      sql: `SELECT r.*, s.name as source_name
            FROM raw_articles r
            JOIN sources s ON r.source_id = s.id
            WHERE r.id = ?`,
      args: [id],
    });
    const raw = rawResult.rows[0];
    if (raw) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO articles (raw_article_id, source_url, source_name, status)
              VALUES (?, ?, ?, 'draft')`,
        args: [raw.id, raw.url, raw.source_name],
      });
    }
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await db.execute({ sql: "DELETE FROM articles WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
