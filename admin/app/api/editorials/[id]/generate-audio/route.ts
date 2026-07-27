import { NextRequest } from "next/server";
import db from "@/lib/db";
import { generateAllAudio } from "@/lib/elevenlabs";
import { commitMultipleToGitHub, type GitHubFileEntry } from "@/lib/publish-core";
import { generateEditorialPageMarkdown } from "@/lib/editorial-core";

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

    // Run generation in the background
    runAudioGeneration(Number(id), editorial as Record<string, unknown>);

    return Response.json({ ok: true, status: "generating" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[generate-audio] Failed for editorial ${id}:`, message);
    return Response.json({ error: message }, { status: 500 });
  }
}

async function runAudioGeneration(id: number, editorial: Record<string, unknown>) {
  try {
    console.log(`[generate-audio] Starting background generation for editorial ${id}`);
    const audioResults = await generateAllAudio(editorial);

    if (audioResults.length === 0) {
      console.error(`[generate-audio] No audio generated for editorial ${id}`);
      return;
    }

    await db.execute({
      sql: "UPDATE editorials SET audio_generated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      args: [id],
    });

    const files: GitHubFileEntry[] = audioResults.map((audio) => ({
      path: `site/src/assets/editorials/audio/${audio.filename}`,
      content: audio.buffer.toString("base64"),
      encoding: "base64" as const,
    }));

    if (editorial.status === "published" && editorial.published_path) {
      const updated = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
      const updatedEditorial = updated.rows[0];
      if (updatedEditorial) {
        const editorialMd = generateEditorialPageMarkdown(updatedEditorial as Record<string, unknown>);
        files.push({
          path: String(editorial.published_path),
          content: editorialMd,
        });
      }
    }

    const title = String(editorial.title_en ?? editorial.slug);
    await commitMultipleToGitHub(files, `Add audio to editorial: ${title}`);
    for (const audio of audioResults) {
      console.log(`[generate-audio] Committed audio: ${audio.filename} (${audio.sizeKB} KB)`);
    }

    console.log(`[generate-audio] Completed for editorial ${id}`);
  } catch (err) {
    console.error(`[generate-audio] Background generation failed for editorial ${id}:`, err instanceof Error ? err.message : err);
  }
}
