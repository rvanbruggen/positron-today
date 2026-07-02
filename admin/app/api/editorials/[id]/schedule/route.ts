import { NextRequest } from "next/server";
import db from "@/lib/db";
import { scheduleEditorial, cancelEditorial } from "@/lib/editorial-publish-timer";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const editorialId = Number(id);

  try {
    const body = await request.json();
    const publishDate = body.publish_date as string | undefined;

    if (!publishDate) {
      return Response.json({ error: "publish_date is required" }, { status: 400 });
    }

    const row = await db.execute({ sql: "SELECT id, status FROM editorials WHERE id = ?", args: [editorialId] });
    const editorial = row.rows[0];
    if (!editorial) return Response.json({ error: "Editorial not found" }, { status: 404 });

    if (editorial.status !== "ready" && editorial.status !== "scheduled") {
      return Response.json({ error: `Cannot schedule editorial with status "${editorial.status}"` }, { status: 400 });
    }

    await db.execute({
      sql: "UPDATE editorials SET status = 'scheduled', publish_date = ?, updated_at = datetime('now') WHERE id = ?",
      args: [publishDate, editorialId],
    });

    scheduleEditorial(editorialId, publishDate);

    return Response.json({ ok: true, publish_date: publishDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[api] Failed to schedule editorial ${id}:`, message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const editorialId = Number(id);

  try {
    const row = await db.execute({ sql: "SELECT id, status FROM editorials WHERE id = ?", args: [editorialId] });
    const editorial = row.rows[0];
    if (!editorial) return Response.json({ error: "Editorial not found" }, { status: 404 });

    if (editorial.status !== "scheduled") {
      return Response.json({ error: "Editorial is not scheduled" }, { status: 400 });
    }

    await db.execute({
      sql: "UPDATE editorials SET status = 'ready', publish_date = NULL, updated_at = datetime('now') WHERE id = ?",
      args: [editorialId],
    });

    cancelEditorial(editorialId);

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[api] Failed to unschedule editorial ${id}:`, message);
    return Response.json({ error: message }, { status: 500 });
  }
}
