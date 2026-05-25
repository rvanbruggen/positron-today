import { twitterLen } from "@/lib/social-helpers";

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

/**
 * Build a platform-aware digest caption.
 *
 * Returns a caption that fits within both X (280 chars) and Bluesky (300
 * graphemes). Instagram and other platforms have much higher limits so
 * X/Bluesky are the binding constraints.
 */
export function buildDigestCaption(articles: DigestCaptionArticle[]): string {
  const header = "Today on Positron:\n\n";
  const suffix = `\n\n${SITE_URL}`;
  const shortHashtags = buildHashtags(articles, 4);
  const hashtagBlock = "\n\n" + shortHashtags.join(" ");
  const SAFETY = 5;
  const X_LIMIT = 280 - SAFETY;
  const BS_LIMIT = 300 - SAFETY;

  function fits(s: string): boolean {
    return twitterLen(s) <= X_LIMIT && [...s].length <= BS_LIMIT;
  }

  function buildWith(maxTitleLen: number): string {
    const lines = articles
      .map((a) => {
        const t = a.title.length > maxTitleLen ? a.title.slice(0, maxTitleLen - 1) + "…" : a.title;
        return `${a.emoji} ${t}`;
      })
      .join("\n");
    return header + lines + hashtagBlock + suffix;
  }

  // Try full titles with hashtags
  const full = buildWith(999);
  if (fits(full)) return full;

  // Progressively truncate titles to keep hashtags
  for (const len of [60, 45, 35, 25]) {
    const attempt = buildWith(len);
    if (fits(attempt)) return attempt;
  }

  return buildWith(20);
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
