import { NextRequest } from "next/server";
import db from "@/lib/db";
import { enqueueAudioGeneration } from "@/lib/audio-queue";
import { getSettings } from "@/lib/settings";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const result = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
    const editorial = result.rows[0];
    if (!editorial) return Response.json({ error: "Editorial not found" }, { status: 404 });

    if (!editorial.content_en) {
      return Response.json({ error: "Editorial has no English content to generate audio from" }, { status: 400 });
    }

    const settings = await getSettings();
    if (settings.editorial_audio_enabled !== "true") {
      return Response.json(
        { error: "Editorial audio is switched off. Enable it in Settings → Editorial audio." },
        { status: 409 },
      );
    }

    if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) {
      return Response.json(
        { error: "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set on the server" },
        { status: 500 },
      );
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = process.env.GITHUB_REPO;
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
      return Response.json({ error: "GITHUB_TOKEN and GITHUB_REPO must be set" }, { status: 500 });
    }

    // Clear any previous failure so the UI polls against a clean slate.
    await db.execute({ sql: "UPDATE editorials SET audio_error = NULL WHERE id = ?", args: [id] });

    enqueueAudioGeneration(Number(id), editorial as Record<string, unknown>);

    return Response.json({ ok: true, status: "generating" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[generate-audio] Failed for editorial ${id}:`, message);
    return Response.json({ error: message }, { status: 500 });
  }
}
