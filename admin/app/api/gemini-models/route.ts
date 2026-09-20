/**
 * Lists the Gemini models the configured API key can use, for the Settings
 * dropdown — the cloud equivalent of /api/ollama-models.
 *
 * Google ships and retires Gemini models often, so the list is fetched live
 * rather than hard-coded the way the Anthropic and OpenAI options are.
 */

const MODELS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/models";

/**
 * The account's model list also carries embedding, image, video, audio,
 * transcription and live-session models, none of which can answer a chat
 * completion. Keep the text models only.
 *
 * This cannot make the dropdown entirely safe: Google keeps listing models it
 * has stopped serving to newer accounts (gemini-2.5-flash is listed but
 * answers 404), and nothing in the response distinguishes them. A model that
 * lists but cannot be called surfaces as an error on first use.
 */
const NON_TEXT_MARKERS = [
  "embedding", "image", "veo", "tts", "audio", "live", "computer-use", "robotics", "transcribe",
];

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "GEMINI_API_KEY is not set — add it to .env.local and restart the admin server." },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(MODELS_ENDPOINT, {
      headers: { "Authorization": `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: `Gemini responded with ${res.status}: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    // The OpenAI-compatible endpoint returns { data: [{ id: "models/gemini-..." }] }
    const models: string[] = (data.data ?? [])
      .map((m: { id: string }) => (m.id ?? "").replace(/^models\//, ""))
      .filter((id: string) => id.startsWith("gemini-"))
      .filter((id: string) => !NON_TEXT_MARKERS.some((marker) => id.includes(marker)))
      .sort((a: string, b: string) => b.localeCompare(a));   // newest generation first

    return Response.json({ ok: true, models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Cannot reach the Gemini API: ${message}` },
      { status: 503 }
    );
  }
}
