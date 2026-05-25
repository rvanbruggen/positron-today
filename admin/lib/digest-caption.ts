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

  const articleLines = articles
    .map((a) => `${a.emoji} ${a.title}`)
    .join("\n");

  const suffix = `\n\n${SITE_URL}`;

  const instagramHashtags = buildHashtags(articles, 8);
  const shortHashtags = buildHashtags(articles, 4);

  const hashtagBlock = "\n\n" + shortHashtags.join(" ");
  const instagramHashtagBlock = "\n\n" + instagramHashtags.join(" ");

  const body = header + articleLines;

  // Check fit for X (280 chars, emoji-weighted) and Bluesky (300 graphemes)
  const SAFETY = 5;
  const withHashtags = body + hashtagBlock + suffix;
  const xLen = twitterLen(withHashtags);
  const bsLen = [...withHashtags].length;

  if (xLen <= 280 - SAFETY && bsLen <= 300 - SAFETY) {
    return withHashtags;
  }

  // If hashtags push it over, try without hashtags
  const withoutHashtags = body + suffix;
  const xLen2 = twitterLen(withoutHashtags);
  const bsLen2 = [...withoutHashtags].length;

  if (xLen2 <= 280 - SAFETY && bsLen2 <= 300 - SAFETY) {
    return withoutHashtags;
  }

  // If still too long, truncate article titles
  const maxTitleLen = 40;
  const shortLines = articles
    .map((a) => {
      const t = a.title.length > maxTitleLen ? a.title.slice(0, maxTitleLen - 1) + "…" : a.title;
      return `${a.emoji} ${t}`;
    })
    .join("\n");

  return header + shortLines + suffix;
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
