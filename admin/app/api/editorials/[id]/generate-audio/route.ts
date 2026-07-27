import { NextRequest } from "next/server";
import db from "@/lib/db";
import { generateAllAudio } from "@/lib/elevenlabs";
import { commitToGitHub } from "@/lib/publish-core";
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

    for (const audio of audioResults) {
      const path = `site/src/assets/editorials/audio/${audio.filename}`;
      const base64 = audio.buffer.toString("base64");
      await commitBinaryToGitHub(path, base64, `Add editorial audio: ${audio.filename}`);
      console.log(`[generate-audio] Committed ${path} (${audio.sizeKB} KB)`);
    }

    await db.execute({
      sql: "UPDATE editorials SET audio_generated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      args: [id],
    });

    if (editorial.status === "published" && editorial.published_path) {
      const updated = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
      const updatedEditorial = updated.rows[0];
      if (updatedEditorial) {
        const editorialMd = generateEditorialPageMarkdown(updatedEditorial as Record<string, unknown>);
        await commitToGitHub(
          String(editorial.published_path),
          editorialMd,
          `Add audio to editorial: ${editorial.title_en ?? editorial.slug}`,
        );
      }
    }

    console.log(`[generate-audio] Completed for editorial ${id}`);
  } catch (err) {
    console.error(`[generate-audio] Background generation failed for editorial ${id}:`, err instanceof Error ? err.message : err);
  }
}

async function commitBinaryToGitHub(path: string, base64Data: string, message: string) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
  const GITHUB_REPO = process.env.GITHUB_REPO!;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };

  let sha: string | undefined;
  const existing = await fetch(url, { headers });
  if (existing.ok) sha = (await existing.json()).sha;

  const body: Record<string, unknown> = { message, content: base64Data, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
}
