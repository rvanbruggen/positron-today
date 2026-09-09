import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const LANGS = ["en"] as const;
type Lang = (typeof LANGS)[number];

function getClient(): ElevenLabsClient {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  return new ElevenLabsClient({ apiKey });
}

function getVoiceId(): string {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID is not set");
  return voiceId;
}

function stripMarkdown(md: string): string {
  return md
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    // Convert links to just their text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove headings markers (keep the text)
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold/italic markers
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    // Remove blockquote markers (keep text)
    .replace(/^>\s?/gm, "")
    // Remove horizontal rules
    .replace(/^---+$/gm, "")
    // Remove list markers
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * ElevenLabs SDK errors stringify as "Status code: 403\nBody: {…}", which is
 * unreadable once it reaches the admin UI. Pull the human-readable line out of
 * the JSON body when there is one, and keep the status code for context.
 */
function readableError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const status = raw.match(/Status code:\s*(\d+)/)?.[1];
  const bodyStart = raw.indexOf("{");
  if (bodyStart !== -1) {
    try {
      const body = JSON.parse(raw.slice(bodyStart));
      const detail = body?.detail;
      const message = typeof detail === "string" ? detail : detail?.message;
      if (message) return new Error(status ? `ElevenLabs ${status}: ${message}` : `ElevenLabs: ${message}`);
    } catch { /* not JSON — fall through to the raw message */ }
  }
  return err instanceof Error ? err : new Error(raw);
}

export async function generateAudio(
  text: string,
  lang: Lang,
): Promise<Buffer> {
  const client = getClient();
  const voiceId = getVoiceId();
  const plainText = stripMarkdown(text);

  if (!plainText.trim()) {
    throw new Error(`No text content for language ${lang}`);
  }

  console.log(
    `[elevenlabs] Generating audio for ${lang} (${plainText.length} chars)`,
  );

  try {
    const response = await client.textToSpeech.convert(voiceId, {
      text: plainText,
      modelId: "eleven_multilingual_v2",
      languageCode: "en",
      outputFormat: "mp3_44100_128",
    });

    const chunks: Uint8Array[] = [];
    const reader = response.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    throw readableError(err);
  }
}

export interface AudioGenerationResult {
  lang: Lang;
  filename: string;
  buffer: Buffer;
  sizeKB: number;
}

export async function generateAllAudio(
  editorial: Record<string, unknown>,
): Promise<AudioGenerationResult[]> {
  const slug = String(editorial.slug);
  const results: AudioGenerationResult[] = [];

  for (const lang of LANGS) {
    const content = editorial[`content_${lang}`];
    if (!content || typeof content !== "string" || !content.trim()) {
      console.warn(`[elevenlabs] Skipping ${lang} — no content`);
      continue;
    }

    const buffer = await generateAudio(content, lang);
    const filename = `${slug}-${lang}.mp3`;
    const sizeKB = Math.round(buffer.length / 1024);
    console.log(`[elevenlabs] Generated ${filename} (${sizeKB} KB)`);
    results.push({ lang, filename, buffer, sizeKB });
  }

  return results;
}
