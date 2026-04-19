/**
 * Cheap title-based duplicate detection.
 *
 * Goal: flag articles that look like they cover the same story, so a human
 * reviewer doesn't unknowingly publish the same topic twice (common when
 * multiple RSS feeds from the same territory all cover the same news).
 *
 * Approach: normalise each title into a set of meaningful tokens (lowercased,
 * punctuation-stripped, stop-words removed, short words dropped) and compute
 * Jaccard similarity (|A ∩ B| / |A ∪ B|) against candidate titles.
 *
 * Deliberately simple: no stemming, no embeddings, no cross-language. Catches
 * the obvious cases for zero infra cost. Upgrade to embeddings later if this
 * misses too many.
 */

// Minimal tri-lingual stop-word list. Not exhaustive — just enough to avoid
// two titles looking "similar" only because they share "the" and "of".
const STOP_WORDS = new Set<string>([
  // English
  "the", "and", "but", "for", "with", "from", "that", "this", "these", "those",
  "will", "have", "has", "had", "was", "were", "are", "been", "being",
  "not", "his", "her", "its", "our", "you", "your", "who", "what", "when",
  "where", "why", "how", "than", "then", "out", "all", "one", "two", "new",
  "over", "into", "about", "after", "before", "more", "most", "some", "any",
  // Dutch
  "het", "een", "van", "voor", "aan", "met", "naar", "door", "bij", "als",
  "zijn", "waren", "was", "wordt", "worden", "heeft", "hebben", "had", "hadden",
  "dat", "deze", "die", "dit", "ook", "nog", "maar", "wel", "niet", "meer",
  "minder", "over", "tussen", "onder", "tegen", "tijdens", "omdat",
  // French
  "les", "des", "une", "est", "sont", "était", "étaient", "être", "avoir",
  "pour", "avec", "dans", "sur", "sous", "entre", "par", "sans", "chez",
  "cette", "ces", "cet", "son", "sa", "ses", "notre", "nos", "votre", "vos",
  "leur", "leurs", "que", "qui", "dont", "mais", "pas", "plus", "moins",
  "très", "trop", "aussi", "encore", "déjà", "bien", "tout", "tous", "toute",
]);

/** Normalise a title into a set of meaningful word tokens. */
export function normaliseTitleTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    // Drop diacritics so "déjà" matches "deja", "françois" matches "francois".
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Replace any non-letter/digit with a space.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(tokens);
}

/** Jaccard similarity of two token sets. Returns 0 if either is empty. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Minimum absolute token overlap required on top of the ratio threshold.
 *  Without this, two 3-word titles sharing 1 word look 33% similar — far too
 *  noisy. Requiring ≥2 shared meaningful words filters out that class of
 *  false positive while keeping real matches. */
export const MIN_SHARED_TOKENS = 2;

/** Minimum Jaccard ratio — tuned by eye to catch "Historic carillon restored"
 *  vs "Carillon of Tienen gets its sound back" without flagging unrelated
 *  headlines that happen to share one noun. */
export const SIMILARITY_THRESHOLD = 0.33;

export type DuplicateCandidate<T> = {
  item: T;
  tokens: Set<string>;
};

export type DuplicateHint<T> = {
  match: T;
  similarity: number;   // 0–1
  sharedTokens: number; // absolute count
};

/** Find the best-matching candidate from `pool` for the given `tokens`.
 *  Returns null if no candidate clears both the similarity and shared-token
 *  thresholds. `skip` excludes self-matches when the candidate is itself in
 *  the pool. */
export function findDuplicateHint<T>(
  tokens: Set<string>,
  pool: DuplicateCandidate<T>[],
  skip?: (candidate: T) => boolean,
): DuplicateHint<T> | null {
  let best: DuplicateHint<T> | null = null;
  for (const c of pool) {
    if (skip && skip(c.item)) continue;
    const sim = jaccardSimilarity(tokens, c.tokens);
    if (sim < SIMILARITY_THRESHOLD) continue;
    let shared = 0;
    for (const t of tokens) if (c.tokens.has(t)) shared++;
    if (shared < MIN_SHARED_TOKENS) continue;
    if (!best || sim > best.similarity) {
      best = { match: c.item, similarity: sim, sharedTokens: shared };
    }
  }
  return best;
}
