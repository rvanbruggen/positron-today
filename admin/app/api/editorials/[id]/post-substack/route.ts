import { NextRequest } from "next/server";
import db from "@/lib/db";
import { postEditorialToSubstack } from "@/lib/editorial-substack";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
  const editorial = result.rows[0];
  if (!editorial) return Response.json({ error: "Not found" }, { status: 404 });
  if (editorial.status !== "published") {
    return Response.json({ error: "Editorial must be published first" }, { status: 400 });
  }

  const postResult = await postEditorialToSubstack(Number(id));
  if (!postResult.ok) {
    return Response.json({ error: postResult.error }, { status: 500 });
  }

  await db.execute({
    sql: "UPDATE editorials SET substack_posted_at = datetime('now') WHERE id = ?",
    args: [id],
  });

  return Response.json({ ok: true, url: postResult.url });
}
