/**
 * Lists the OpenAI models the configured API key can use, for the Settings
 * dropdown — the OpenAI counterpart of /api/gemini-models.
 *
 * The OpenAI options used to be hard-coded and fell a year behind what the
 * key could reach, so the list is now fetched live like Gemini's.
 */

const MODELS_ENDPOINT = "https://api.openai.com/v1/models";

/**
 * The account's model list also carries embedding, image, video, audio,
 * transcription, moderation and realtime models, none of which can answer a
 * chat completion. Keep the text models only.
 */
const NON_TEXT_MARKERS = [
  "embedding", "image", "dall-e", "sora", "tts", "whisper", "audio", "realtime",
  "transcribe", "moderation", "search", "live", "codex", "instruct",
];

/**
 * The models actually offered in Settings, cheapest first. The key lists
 * around eighty text models; all but these are deliberately withheld, because
 * the list is a menu of things that cost money per call and most entries are
 * older or a worse deal than one already here.
 *
 * Prices are per 1M tokens, standard tier, checked 1 October 2026. OpenAI
 * names its tiers Luna (budget), Sol (balanced), Terra and Astra (flagship).
 *
 *   gpt-6-luna   $0.10/$0.50  cheapest — filtering, story folding.
 *                             Undercuts gpt-4.1-mini ($0.40/$1.60).
 *   gpt-6.1-sol  $2.00/$10    balanced — summarisation
 *   gpt-6-astra  $10/$50      flagship — Necessary Negativity, if ever needed
 *
 * The 5.6 line is withheld: each tier there costs more than its 6.x
 * equivalent (gpt-5.6-luna is $0.20/$1.20).
 *
 * To offer a different model, add its id here.
 */
const OPENAI_SHORTLIST = [
  "gpt-6-luna",
  "gpt-6.1-sol",
  "gpt-6-astra",
];

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set — add it to .env.local and restart the admin server." },
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
        { error: `OpenAI responded with ${res.status}: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const available: string[] = (data.data ?? [])
      .map((m: { id: string }) => m.id ?? "")
      .filter((id: string) => id.startsWith("gpt-") || /^o[1-9]/i.test(id))
      .filter((id: string) => !NON_TEXT_MARKERS.some((marker) => id.includes(marker)));

    // Offer the shortlist, in shortlist order, limited to what this key lists.
    const shortlisted = OPENAI_SHORTLIST.filter((id) => available.includes(id));

    // Safety valve: if OpenAI renames or retires the whole shortlist, fall back
    // to every text model rather than leaving the admin with an empty dropdown
    // and no way to pick anything.
    const models = shortlisted.length > 0
      ? shortlisted
      : available.sort((a, b) => b.localeCompare(a));

    return Response.json({ ok: true, models, shortlisted: shortlisted.length > 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Cannot reach the OpenAI API: ${message}` },
      { status: 503 }
    );
  }
}
