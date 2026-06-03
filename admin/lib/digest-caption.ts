import { twitterLen } from "@/lib/social-helpers";
import { getFilterProvider } from "@/lib/llm";

const SITE_URL = "https://positron.today";

const EVERGREEN_HASHTAGS = ["#PositiveNews", "#GoodNews"];

export interface DigestCaptionArticle {
  emoji: string;
  title: string;
  tags: string[];
}

function tagToHashtag(tag: string): string {
  return "#" + tag
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function buildHashtags(articles: DigestCaptionArticle[], maxCount: number): string[] {
  const tagCounts = new Map<string, number>();
  for (const a of articles) {
    for (const tag of a.tags) {
      const ht = tagToHashtag(tag);
      if (ht.length <= 1) continue;
      tagCounts.set(ht, (tagCounts.get(ht) ?? 0) + 1);
    }
  }

  const articleHashtags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([ht]) => ht)
    .filter((ht) => !EVERGREEN_HASHTAGS.includes(ht));

  const all = [...EVERGREEN_HASHTAGS, ...articleHashtags];
  return all.slice(0, maxCount);
}

const DIGEST_SYSTEM_PROMPT = `You write short social media captions for Positron Today, a positive-news website.
You will receive a handful of article titles (3 to 5). Write a single short, upbeat paragraph (2-3 sentences max) that describes the stories together.
Rules:
- Warm, casual tone. No corporate speak.
- Do NOT list the titles. Weave them into a natural summary.
- Include the article emoji at natural points in the text.
- STRICT character limit: your response must be under {maxChars} characters total. Count carefully.
- Do NOT include hashtags, URLs, or "Today on Positron". Just the summary text.
- Output ONLY the summary text, nothing else.`;

/**
 * Build a platform-aware digest caption using an LLM to summarise the articles
 * into a short, engaging blurb that fits X (280) and Bluesky (300) limits.
 */
export async function buildDigestCaption(articles: DigestCaptionArticle[]): Promise<string> {
  const shortHashtags = buildHashtags(articles, 4);
  const hashtagBlock = "\n\n" + shortHashtags.join(" ");
  const suffix = `\n\n${SITE_URL}`;

  // Budget: total limit minus the fixed parts (hashtags + URL + newlines)
  const fixedLen = twitterLen(hashtagBlock + suffix);
  const maxSummaryChars = 280 - fixedLen - 10; // 10 char safety margin

  const articlesText = articles
    .map((a) => `${a.emoji} ${a.title}`)
    .join("\n");

  const systemPrompt = DIGEST_SYSTEM_PROMPT.replace("{maxChars}", String(maxSummaryChars));

  try {
    const llm = await getFilterProvider();
    const summary = await llm.generate(
      `Summarise these ${articles.length} positive news stories in under ${maxSummaryChars} characters:\n\n${articlesText}`,
      systemPrompt,
      150,
    );

    const cleaned = summary.trim().replace(/^["']|["']$/g, "");

    const full = cleaned + hashtagBlock + suffix;
    if (twitterLen(full) <= 280 && [...full].length <= 300) {
      return full;
    }

    // LLM went over budget — truncate to fit
    const maxLen = maxSummaryChars;
    const truncated = cleaned.length > maxLen
      ? cleaned.slice(0, maxLen - 1) + "…"
      : cleaned;
    return truncated + hashtagBlock + suffix;
  } catch (err) {
    console.error("[digest-caption] LLM failed, falling back to titles:", err);
    return buildFallbackCaption(articles, hashtagBlock, suffix);
  }
}

function buildFallbackCaption(
  articles: DigestCaptionArticle[],
  hashtagBlock: string,
  suffix: string,
): string {
  function fits(s: string): boolean {
    return twitterLen(s) <= 275 && [...s].length <= 295;
  }

  for (const maxLen of [45, 35, 25]) {
    const lines = articles
      .map((a) => {
        const t = a.title.length > maxLen ? a.title.slice(0, maxLen - 1) + "…" : a.title;
        return `${a.emoji} ${t}`;
      })
      .join("\n");
    const attempt = "Today on Positron:\n\n" + lines + hashtagBlock + suffix;
    if (fits(attempt)) return attempt;
  }

  const lines = articles.map((a) => `${a.emoji} ${a.title.slice(0, 19)}…`).join("\n");
  return "Today on Positron:\n\n" + lines + hashtagBlock + suffix;
}

/**
 * Build an Instagram-specific caption with more hashtags (Instagram allows
 * 2200 chars and benefits from 6-8 hashtags for discovery).
 */
export function buildInstagramDigestCaption(articles: DigestCaptionArticle[]): string {
  const header = "Today on Positron:\n\n";

  const articleLines = articles
    .map((a) => `${a.emoji} ${a.title}`)
    .join("\n");

  const hashtags = buildHashtags(articles, 8);
  const hashtagBlock = "\n\n" + hashtags.join(" ");

  return header + articleLines + hashtagBlock + `\n\n${SITE_URL}`;
}
