import { NextRequest } from "next/server";
import db from "@/lib/db";
import { unpublishEditorial } from "@/lib/editorial-core";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
  const editorial = result.rows[0];
  if (!editorial) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(editorial);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();

  const allowedFields = [
    "title_en", "title_nl", "title_fr",
    "summary_en", "summary_nl", "summary_fr",
    "content_en", "content_nl", "content_fr",
    "article_emoji", "post_to_substack",
  ];

  const sets: string[] = [];
  const args: (string | number | null)[] = [];

  for (const field of allowedFields) {
    if (field in body) {
      sets.push(`${field} = ?`);
      args.push(body[field]);
    }
  }

  if (sets.length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  args.push(id);

  await db.execute({
    sql: `UPDATE editorials SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });

  const result = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
  return Response.json(result.rows[0]);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await db.execute({ sql: "SELECT status FROM editorials WHERE id = ?", args: [id] });
  const editorial = result.rows[0];
  if (!editorial) return Response.json({ error: "Not found" }, { status: 404 });
  if (editorial.status === "published") {
    const unpubResult = await unpublishEditorial(Number(id));
    if (!unpubResult.ok) {
      return Response.json({ error: `Failed to unpublish: ${unpubResult.error}` }, { status: 500 });
    }
  }

  await db.execute({ sql: "DELETE FROM editorials WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
