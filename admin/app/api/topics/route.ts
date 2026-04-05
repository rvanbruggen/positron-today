import { NextRequest } from "next/server";
import db from "@/lib/db";

export async function GET() {
  const result = await db.execute("SELECT * FROM topics ORDER BY name ASC");
  return Response.json(result.rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, emoji } = body;
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  try {
    const result = await db.execute({
      sql: "INSERT INTO topics (name, slug, emoji) VALUES (?, ?, ?) RETURNING *",
      args: [name, slug, emoji ?? "📰"],
    });
    return Response.json(result.rows[0], { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("UNIQUE")) {
      return Response.json({ error: "A topic with this name already exists" }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await db.execute({ sql: "DELETE FROM topics WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
