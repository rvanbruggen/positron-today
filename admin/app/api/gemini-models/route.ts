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

/**
 * The models actually offered in Settings, cheapest first. Google lists around
 * twenty text models; all but these are deliberately withheld, because the list
 * is a menu of things that cost money per call and most entries are a worse
 * deal than one already here.
 *
 * Prices are per 1M tokens, checked 21 September 2026, output including
 * thinking tokens. The numbering is not a price or recency order: the 3.5 line
 * is legacy, and gemini-3.5-flash ($1.50/$9.00) costs twice gemini-3.8-flash.
 *
 *   gemini-3.1-flash-lite  $0.25/$1.50  cheapest — filtering, story folding
 *   gemini-3.5-flash-lite  $0.30/$2.50  alternative lite, if 3.1 disappoints
 *   gemini-3.8-flash       $0.75/$3.75  best Flash — summarisation
 *                                       (rises to $1.50/$7.50 on 1 Jan 2027)
 *   gemini-pro-latest      ~$2.00/$12   Pro-class judgement — Necessary
 *                                       Negativity. An alias because every
 *                                       pinned Pro id is a preview.
 *
 * To offer a different model, add its id here.
 */
const GEMINI_SHORTLIST = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-pro-latest",
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
    const available: string[] = (data.data ?? [])
      .map((m: { id: string }) => (m.id ?? "").replace(/^models\//, ""))
      .filter((id: string) => id.startsWith("gemini-"))
      .filter((id: string) => !NON_TEXT_MARKERS.some((marker) => id.includes(marker)));

    // Offer the shortlist, in shortlist order, limited to what this key lists.
    const shortlisted = GEMINI_SHORTLIST.filter((id) => available.includes(id));

    // Safety valve: if Google renames or retires the whole shortlist, fall back
    // to every text model rather than leaving the admin with an empty dropdown
    // and no way to pick anything.
    const models = shortlisted.length > 0
      ? shortlisted
      : available.sort((a, b) => b.localeCompare(a));

    return Response.json({ ok: true, models, shortlisted: shortlisted.length > 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Cannot reach the Gemini API: ${message}` },
      { status: 503 }
    );
  }
}
