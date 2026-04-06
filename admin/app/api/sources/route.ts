import { NextRequest } from "next/server";
import db from "@/lib/db";

export async function GET() {
  const result = await db.execute("SELECT * FROM sources ORDER BY name ASC");
  return Response.json(result.rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, url, feed_url, type, language } = body;

  if (!name || !url || !type) {
    return Response.json({ error: "name, url and type are required" }, { status: 400 });
  }

  try {
    const result = await db.execute({
      sql: "INSERT INTO sources (name, url, feed_url, type, language) VALUES (?, ?, ?, ?, ?) RETURNING *",
      args: [name, url, feed_url || null, type, language ?? "en"],
    });
    return Response.json(result.rows[0], { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("UNIQUE")) {
      return Response.json({ error: "A source with this URL already exists" }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, active, name, url, feed_url, language } = body;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  if (active !== undefined) {
    // Toggle active state only
    await db.execute({
      sql: "UPDATE sources SET active = ? WHERE id = ?",
      args: [active ? 1 : 0, id],
    });
  } else {
    // Full field edit
    await db.execute({
      sql: "UPDATE sources SET name = ?, url = ?, feed_url = ?, language = ? WHERE id = ?",
      args: [name, url, feed_url || null, language, id],
    });
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await db.execute({ sql: "DELETE FROM sources WHERE id = ?", args: [id] });
  return Response.json({ ok: true });
}
