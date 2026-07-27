import { NextRequest } from "next/server";
import db from "@/lib/db";
import { enqueueAudioGeneration } from "@/lib/audio-queue";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const result = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
    const editorial = result.rows[0];
    if (!editorial) return Response.json({ error: "Editorial not found" }, { status: 404 });

    if (!editorial.content_en) {
      return Response.json({ error: "Editorial has no English content to generate audio from" }, { status: 400 });
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = process.env.GITHUB_REPO;
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
      return Response.json({ error: "GITHUB_TOKEN and GITHUB_REPO must be set" }, { status: 500 });
    }

    enqueueAudioGeneration(Number(id), editorial as Record<string, unknown>);

    return Response.json({ ok: true, status: "generating" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[generate-audio] Failed for editorial ${id}:`, message);
    return Response.json({ error: message }, { status: 500 });
  }
}
