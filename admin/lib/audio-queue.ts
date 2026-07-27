import db from "@/lib/db";
import { generateAllAudio } from "@/lib/elevenlabs";
import { commitMultipleToGitHub, type GitHubFileEntry } from "@/lib/publish-core";
import { generateEditorialPageMarkdown } from "@/lib/editorial-core";

interface QueueItem {
  id: number;
  editorial: Record<string, unknown>;
}

const queue: QueueItem[] = [];
let processing = false;

export function enqueueAudioGeneration(id: number, editorial: Record<string, unknown>) {
  queue.push({ id, editorial });
  console.log(`[audio-queue] Enqueued editorial ${id} (queue length: ${queue.length})`);
  drain();
}

function drain() {
  if (processing || queue.length === 0) return;
  processing = true;
  const item = queue.shift()!;
  processItem(item).finally(() => {
    processing = false;
    drain();
  });
}

async function processItem({ id, editorial }: QueueItem) {
  try {
    console.log(`[audio-queue] Starting generation for editorial ${id} (${queue.length} remaining in queue)`);
    const audioResults = await generateAllAudio(editorial);

    if (audioResults.length === 0) {
      console.error(`[audio-queue] No audio generated for editorial ${id}`);
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
      console.log(`[audio-queue] Committed audio: ${audio.filename} (${audio.sizeKB} KB)`);
    }

    console.log(`[audio-queue] Completed editorial ${id}`);
  } catch (err) {
    console.error(`[audio-queue] Failed for editorial ${id}:`, err instanceof Error ? err.message : err);
  }
}
