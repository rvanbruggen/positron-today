/**
 * Prompt building for the two AI tasks.
 *
 * Kept as a pure utility module (no DB or server imports) so it can be imported
 * by both server-side route handlers and the "use client" settings page.
 */

import { CATEGORY_PROMPT_LIST } from "./rejection-categories";

// ── Positivity filter ─────────────────────────────────────────────────────────

export const DEFAULT_FILTER_INSTRUCTIONS = `You are a filter for Positron.today, a positive-news website. Decide whether the article fits a strict positive-news editorial standard.

REJECT the article (verdict: NO) if ANY of the rules below is true. These are hard rules - do not invent exceptions, do not weigh "but it's heartwarming" against them.

1. Sports. Professional sports content that is related to non-exceptional results, league standings, transfers, injuries, match previews, comeback stories, charity matches, retirements, contracts, sports-business news that is not truly, once in a lifetime level exceptional. Only allow exceptions if the story is truly emotional, inspiring, or human-interest with a unique characteristic that can be universally appreciated.

2. Local-only relevance. The article would not interest a reader in another country. Single-village, single-town, single-neighbourhood, single-school, or municipal content: roadworks, community events, fundraisers, council decisions, regional weather, local crime or courts, neighbourhood disputes - even with a positive resolution. This includes: local festivals and markets ("Vijfde editie rommelmarkt"), neighbourhood revitalisation ("buurt herontdekt park"), local building or infrastructure projects, regional visitor/tourism statistics ("Paasvakantie lokte veel Duitsers"), local animal sightings, municipal investments, and any story whose main news value is "N people attended X" in a specific locality.

3. Celebrities and entertainment industry. Gossip, awards, premieres, casting, relationships, royal-family colour pieces, red-carpet coverage - local or global fame. This extends to: TV personality profiles, reality-show contestants, celebrity pregnancy or family announcements, fan-culture stories, personal milestones of known figures, and any story that only matters because a famous person is involved.

4. Corporate PR. Product launches, funding rounds, earnings, partnership announcements, marketing news - even when pitched as benefiting users or society.

5. Routine tech/industry updates. Software releases, version updates, industry reports, gadget reviews, AI-feature announcements - unless the article documents a clearly proven, civilisation-scale breakthrough (cure, major scientific discovery).

6. Politics. Legislation, elections, partisan commentary, government decisions, political-figure profiles, geopolitical analysis - positive spin or not. The only exception would be political stories marking major breakthroughs in conflicts, exceptional agreements on long disputed or debated topics (e.g. about climate change, social media or AI adoption - topics that have believers and non-believers).

7. Viral feel-good and emotional clickbait. Stories whose primary appeal is an emotional reaction - "aww", laughter, tears, or outrage-then-relief - rather than substance. Reject: cute animal antics, heartwarming-stranger encounters, viral social-media moments, "faith in humanity restored" anecdotes, family or parenting moments caught on camera, and personality quizzes or listicles. Test: strip the emotional hook - is there still a meaningful story? If not, reject. A rescued individual animal is not conservation news. A kind stranger at a checkout is not societal progress.

8. Individual human-interest without universal significance. Personal profiles, career pivots, "this person did an amazing thing" stories - unless the achievement represents a genuine first, a replicable model, or a breakthrough with impact beyond one life. Reject: inspiring-individual stories where the takeaway is just "this person is great", entrepreneurial origin stories, personal health journeys, family reunion or relationship stories, and any story about one person's kindness or persistence that doesn't reveal a wider truth.

9. Recovery-from-negative / silver linings. Stories that are only "positive" because they follow something bad: disaster clean-up progress, animals rescued from abuse or injury, buildings reopening after damage, people recovering from trauma. If the headline requires knowledge of the preceding negative event to make sense, the story is a negative-event update, not positive news.

10. Event-coverage padding. When a newsworthy event happens (eclipse, meteor shower, milestone anniversary), only the most substantive article deserves consideration. Reject: photo roundups, "how to watch/see X", viewer-reaction compilations, timelapse videos, "N people gathered for X", and any article that reports on the coverage of an event rather than the event's significance itself. "Good News in History" daily roundups also fall here.

11. Cultural reviews and lifestyle content. Reviews of concerts, films, exhibitions, restaurants, travel destinations. Recipe roundups, "new addresses", gift guides. These are entertainment or lifestyle journalism, not positive news - even when the tone is enthusiastic.

ACCEPT (verdict: YES) only when all of these hold:

- The story is unambiguously positive - a reader should feel genuinely uplifted, not just informed. Unexpected stories are a bonus.
- It has broad human relevance and travels across countries/cultures.
- None of rules 1-11 apply.
- The story has substance beyond the emotional hook. Ask: does this article teach the reader something new about how the world works, or does it just make them briefly smile? Science, environment, medicine, technology, and human achievement that advances understanding all pass this test. Cute, warm, and touching do not, by themselves.

When in doubt, reject. False negatives are acceptable; false positives are not.`;

/**
 * Assembles the complete prompt sent to the LLM for a given article.
 * `instructions` is either the user's custom override or DEFAULT_FILTER_INSTRUCTIONS.
 *
 * When `translateToEnglish` is true (sources with an input language outside
 * en/nl/fr, including auto-detect), the model is also asked for a short
 * English rendering of the title + snippet so the human reviewer can judge
 * the article on the Preview page without reading the original language.
 */
export function buildFilterPrompt(
  instructions: string,
  title: string,
  snippet: string,
  translateToEnglish = false,
): string {
  const translationFields = translateToEnglish
    ? `\nThe article may be in a language other than English. ALWAYS also include:
  - "preview_title_en":   a faithful English translation of the title (one short line)
  - "preview_snippet_en": a 1-2 sentence English rendering of what the article is about
These two fields are required regardless of verdict.`
    : "";

  const yesExample = translateToEnglish
    ? `{"verdict":"YES","score":7,"preview_title_en":"...","preview_snippet_en":"..."}`
    : `{"verdict":"YES","score":7}`;

  const noExample = translateToEnglish
    ? `{"verdict":"NO","score":3,"reason":"1-2 sentence explanation of why this story is too negative or not uplifting","category":"<slug>","preview_title_en":"...","preview_snippet_en":"..."}`
    : `{"verdict":"NO","score":3,"reason":"1-2 sentence explanation of why this story is too negative or not uplifting","category":"<slug>"}`;

  return `${instructions}

Article title: ${title}
Snippet: ${snippet}

Reply with JSON only — no other text.
Always include a "score" field: an integer from 1 (not positive at all) to 10 (exceptionally uplifting).${translationFields}

If it fits: ${yesExample}

If it does NOT fit: ${noExample}

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

// ── Necessary Negativity ──────────────────────────────────────────────────────

/**
 * Stage 1 — significance ranking.
 *
 * Deliberately kept narrow: the model sees the headline and which outlets ran
 * it, and nothing else. Feeding it the publisher's RSS snippet as well was
 * tested over 11 weeks and produced a selection judged worse, so it stays out.
 * The filter's own `rejection_reason` is also withheld on purpose, so the
 * significance judgement stays independent of the tone judgement that put the
 * article in the reject pile in the first place.
 */
export const NEVER_SKIP_RANK_INSTRUCTIONS = `You rank news stories by CONSEQUENCE, not by how upsetting they are.

Context: these are articles a positive-news filter rejected for being negative. The task is to find the few that are genuinely consequential — the ones whose absence from public attention would be a real loss — and separate them from the reflexively negative noise that shares the same topic tag.

High significance: structural change, new evidence about a long-run risk, policy or legal shifts with wide reach, findings that alter how a problem is understood, harm at scale.

LOW significance despite the tag: product launches and gadget reviews, corporate earnings or funding rounds, service outages, individual crimes or lawsuits with no wider precedent, celebrity or influencer disputes, local human-interest, opinion and comment pieces, sport, seasonal weather reports.

Judge the story, not the headline's emotional charge. A calm headline about a policy change usually outranks an alarming headline about one incident. Titles appear in their original language — judge them as they are, do not translate.

If fewer than three candidates are genuinely consequential, return fewer picks. Do not pad.`;

/** Stage 1 prompt: numbered candidate list in, picks + rationale out. */
export function buildNeverSkipRankPrompt(
  instructions: string,
  themeLabel: string,
  weekLabel: string,
  candidates: { title: string; sources: string[] }[],
  maxPicks: number,
): string {
  const list = candidates
    .map((c, i) => `${i + 1}. [${c.sources.length} outlet${c.sources.length > 1 ? "s" : ""}: ${c.sources.slice(0, 3).join(", ")}] ${c.title}`)
    .join("\n");

  return `${instructions}

Theme: ${themeLabel}
Week: ${weekLabel}

${candidates.length} candidate stories:

${list}

Reply with JSON only — no other text, no markdown fences:
{"picks":[{"index":1,"why":"one sentence, max 25 words, on why this is consequential"}],"discarded_note":"one short sentence naming the kind of low-significance material set aside"}

Return at most ${maxPicks} picks, most significant first. "index" is the 1-based number from the list above.`;
}

/**
 * Stage 2 — trilingual display text.
 *
 * The public page never shows the publisher's headline. Every visible string is
 * Positron's own prose, produced in all three languages in a single pass so the
 * versions are siblings rather than a translation chain (EN→NL→FR drifts).
 */
export function buildNeverSkipRenderPrompt(
  themeLabel: string,
  weekLabel: string,
  picks: { title: string; sources: string[]; why: string }[],
): string {
  const list = picks
    .map((p, i) => `${i + 1}. [${p.sources.join(", ")}] ${p.title}\n   Why it was selected: ${p.why}`)
    .join("\n");

  return `You write the display text for "Necessary Negativity" on Positron.today — a weekly page surfacing the consequential negative stories the site's positive-news filter set aside.

Theme: ${themeLabel}
Week: ${weekLabel}

The ${picks.length} selected stories, with their original headlines and why each was chosen:

${list}

For EACH story, write a "line": one sentence, maximum 20 words, stating plainly what the story is. This REPLACES the headline on the page — the reader never sees the original. So it must stand alone, carry the concrete fact where there is one (a number, a place, a body that acted), and read as a statement rather than a teaser. Do not use a question, a colon-prefixed label, or quotation marks. Do not name the outlet.

Also write a "summary" for the theme as a whole: 2 to 3 sentences on what this subject looked like this week across the selected stories.

VOICE — this is site chrome, not an opinion column:
- Passive or system voice. NEVER use "we", "us", "our" (or "wij", "ons", "onze" / "nous", "notre", "nos").
- No hype, no alarm, no rhetorical questions. State what happened and what it bears on.
- Do not address the reader or tell them how to feel.

LANGUAGE RULES — mandatory, never skip any language:
- line_en / summary_en: write in ENGLISH
- line_nl / summary_nl: write in DUTCH (Nederlands) — fully translate, do not copy the English
- line_fr / summary_fr: write in FRENCH (Français) — fully translate, do not copy the English
Each language is written from the story itself, not translated word-for-word from the English.

Reply with JSON only — no other text, no markdown fences:
{"summary_en":"...","summary_nl":"...","summary_fr":"...","lines":[{"line_en":"...","line_nl":"...","line_fr":"..."}]}

The "lines" array must have exactly ${picks.length} entries, in the same order as the list above. Every field is required and none may be empty or copied from another language.`;
}
