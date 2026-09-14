/**
 * Batch positivity filter — several articles per LLM call.
 *
 * Returns a verdict for every article the model answered cleanly. Articles it
 * skipped, numbered wrongly, or lost to a truncated reply are simply absent
 * from the result; the caller falls back to the one-article classify() path
 * for those, so a bad batch costs a few extra calls, never a lost article.
 */

import type { ClassifyResult, LLMProvider } from "@/lib/llm";
import { normaliseClassifyObject } from "@/lib/llm";
import { buildFilterBatchPrompt } from "@/lib/prompts";

/** Articles per call. Small enough that a truncated or garbled reply loses little. */
export const CLASSIFY_BATCH_SIZE = 15;

/**
 * RSS snippets are usually a sentence or two, but some feeds put the whole
 * article body in the description. The verdict is made from headline + lede,
 * so the long tail is trimmed rather than paid for.
 */
const MAX_SNIPPET_CHARS = 1000;

/**
 * Output budget. A verdict is ~20 tokens, a rejection with reason ~60, and a
 * translated preview adds ~80 — about 2,500 for a full batch in the worst case.
 * Headroom covers thinking models, whose reasoning draws on the same budget.
 */
const MAX_TOKENS = 8000;

export interface BatchArticle {
  title: string;
  snippet: string;
  translateToEnglish: boolean;
}

/** Verdicts by position in `articles` (0-based). Missing positions need a fallback. */
export async function classifyBatch(
  provider: LLMProvider,
  instructions: string,
  articles: BatchArticle[],
): Promise<Map<number, ClassifyResult>> {
  const { system, user } = buildFilterBatchPrompt(
    instructions,
    articles.map((a) => ({ ...a, snippet: a.snippet.slice(0, MAX_SNIPPET_CHARS) })),
  );

  // Temperature 0 where the model accepts it, as the single-article filter does,
  // so re-running the same article gives the same verdict.
  const raw = await provider.generate(user, system, MAX_TOKENS, 0);
  return parseBatchResponse(raw, articles);
}

function parseBatchResponse(raw: string, articles: BatchArticle[]): Map<number, ClassifyResult> {
  const results = new Map<number, ClassifyResult>();

  // Each verdict is a flat object (no nested braces), so they can be picked out
  // one by one. Unlike JSON.parse on the whole array, this still recovers every
  // complete verdict from a reply that was cut off mid-way.
  for (const match of raw.matchAll(/\{[^{}]*\}/g)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      continue;
    }

    const index = Number(parsed.id) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= articles.length) continue;
    if (results.has(index)) continue;   // first answer wins
    if (parsed.verdict !== "YES" && parsed.verdict !== "NO") continue;

    const result = normaliseClassifyObject(parsed);

    // A translated preview was asked for and is missing — let the single-article
    // path redo it, rather than leave the Preview page with an untranslated item.
    if (articles[index].translateToEnglish && !result.preview_title_en) continue;

    results.set(index, result);
  }

  return results;
}
