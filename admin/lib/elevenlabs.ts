import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const LANGS = ["en", "nl", "fr"] as const;
type Lang = (typeof LANGS)[number];

const LANGUAGE_CODES: Record<Lang, string> = {
  en: "en",
  nl: "nl",
  fr: "fr",
};

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

  const response = await client.textToSpeech.convert(voiceId, {
    text: plainText,
    modelId: "eleven_multilingual_v2",
    languageCode: LANGUAGE_CODES[lang],
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
