/**
 * Prompt building for the two AI tasks.
 *
 * Kept as a pure utility module (no DB or server imports) so it can be imported
 * by both server-side route handlers and the "use client" settings page.
 */

import { CATEGORY_PROMPT_LIST } from "./rejection-categories";

// ── Positivity filter ─────────────────────────────────────────────────────────

export const THRESHOLD_LABELS: Record<number, string> = {
  1:  "1 — very lenient  (nearly everything positive-leaning passes)",
  2:  "2 — lenient+",
  3:  "3 — lenient",
  4:  "4 — slightly lenient",
  5:  "5 — balanced  (default)",
  6:  "6 — slightly strict",
  7:  "7 — strict",
  8:  "8 — very strict",
  9:  "9 — extremely strict",
  10: "10 — maximum  (only clearly uplifting stories pass)",
};

function thresholdInstruction(threshold: number): string {
  if (threshold <= 2) {
    return `Be generous. Accept any story that has a positive angle, even when mixed with some negative context. Neutral-positive stories about science, community, innovation, or human interest are welcome. Only reject stories that are clearly and predominantly negative — crime, war, major disasters, or acute health emergencies.`;
  }
  if (threshold <= 4) {
    return `Apply a lenient filter. Accept stories that have a clear positive element, even if not exclusively uplifting. Mixed stories are acceptable if the net tone is positive or neutral-positive. Reject stories that lack any meaningful uplifting angle, as well as clearly negative stories about crime, war, disasters, economic doom, or health scares.`;
  }
  if (threshold <= 6) {
    return `Apply a balanced filter. A good fit: genuinely good news, heartwarming stories, scientific breakthroughs, environmental wins, funny or lighthearted stories, inspiring achievements — anything that leaves the reader feeling better. NOT a good fit: crime, war, political conflict, disasters, economic doom, health scares, or predominantly negative stories — even with a small positive angle.`;
  }
  if (threshold <= 8) {
    return `Apply a strict filter. Only accept stories that are clearly and unambiguously positive — stories that will leave readers feeling genuinely uplifted. Reject anything mixed, ambiguous, or merely interesting-but-neutral. Media industry news, corporate PR, purely informational tech updates, and political stories with a positive spin should all be rejected unless an unmistakable human-interest uplift is present.`;
  }
  return `Apply maximum strictness. Only truly exceptional positive stories qualify — the kind that would make most readers smile or feel genuinely moved. Reject anything that is not clearly and powerfully uplifting: mixed stories, neutral science, mildly positive news, media industry updates, corporate announcements, and political stories. When in doubt, reject.`;
}

/**
 * Returns the instructional/tone block for the positivity filter.
 * This is the part the slider controls and the user can override.
 * The article data and JSON format are always appended separately by buildFilterPrompt().
 */
export function buildFilterInstructions(threshold: number): string {
  return `You are a filter for "Positiviteiten", a positive-news website.

${thresholdInstruction(Math.max(1, Math.min(10, threshold)))}`;
}

export const DEFAULT_FILTER_INSTRUCTIONS = buildFilterInstructions(5);

/**
 * Assembles the complete prompt sent to the LLM for a given article.
 * `instructions` is either the user's custom override or the output of buildFilterInstructions().
 */
export function buildFilterPrompt(
  instructions: string,
  title: string,
  snippet: string,
): string {
  return `${instructions}

Article title: ${title}
Snippet: ${snippet}

Reply with JSON only — no other text.
Always include a "score" field: an integer from 1 (not positive at all) to 10 (exceptionally uplifting).

If it fits: {"verdict":"YES","score":7}

If it does NOT fit: {"verdict":"NO","score":3,"reason":"1-2 sentence explanation of why this story is too negative or not uplifting","category":"<slug>"}

Valid category slugs (pick the single best match):
${CATEGORY_PROMPT_LIST}`;
}

// ── Summarisation style / voice ───────────────────────────────────────────────

/**
 * The voice/style block injected at the top of every summarisation prompt.
 * Must match the STYLE constant in app/api/summarise/route.ts exactly.
 * When a user saves a custom override, this string is the starting point they edit.
 */
export const DEFAULT_SUMMARISE_STYLE = `You write in the voice of Rik Van Bruggen - a curious, enthusiastic Belgian who thinks out loud.
Key rules:
- Warm, direct, conversational. Never stiff or corporate.
- Use "I" naturally. Show genuine enthusiasm where it fits.
- Use casual connectives: "So:", "Now,", "Which brings me to...", "And here's the thing."
- Use a dash "-" never an em-dash "—".
- Titles: capitalise only the first word, everything else lowercase.
- Each summary MUST be exactly 4-5 sentences. Never fewer than 4. No bullet lists. No sign-off.
- Always positive tone - this is a positive news site.

LANGUAGE RULES — this is mandatory, never skip any language:
- title_en and summary_en: write in ENGLISH
- title_nl and summary_nl: write in DUTCH (Nederlands) - fully translate, do not copy the English
- title_fr and summary_fr: write in FRENCH (Français) - fully translate, do not copy the English
All six text fields are required. Never leave any field empty or copy text from another language field.`;
