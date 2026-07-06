import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";

const client = new Anthropic();

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const CACHE_TTL_MS = 10 * 60_000;

const ipHits = new Map<string, { count: number; resetAt: number }>();
const responseCache = new Map<
  string,
  { data: object; expiresAt: number }
>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

function getCached(key: string): object | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: object) {
  responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isValidPublicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return null;
  }
  return url;
}

function extractHeadlines(html: string): string[] {
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const headlines: string[] = [];

  const selectors = [
    "h1",
    "h2",
    "h3",
    "article h1, article h2, article h3",
    '[class*="headline"]',
    '[class*="title"]',
    '[data-testid*="headline"]',
  ];

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (text.length >= 10 && text.length <= 300 && !seen.has(text)) {
        seen.add(text);
        headlines.push(text);
      }
    });
  }

  return headlines.slice(0, 50);
}

const FEED_PATHS = [
  "/feed",
  "/rss",
  "/feed/rss",
  "/rss.xml",
  "/atom.xml",
  "/feed.xml",
  "/feeds/posts/default",
  "/index.xml",
];

async function fetchWithTimeout(
  targetUrl: string,
  accept: string
): Promise<Response | null> {
  try {
    const r = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PositronScorer/1.0; +https://positron.today)",
        Accept: accept,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

function extractHeadlinesFromFeed(xml: string): string[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const titles: string[] = [];
  const seen = new Set<string>();

  $("item > title, entry > title").each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (text.length >= 10 && text.length <= 300 && !seen.has(text)) {
      seen.add(text);
      titles.push(text);
    }
  });

  return titles.slice(0, 50);
}

function discoverFeedUrlFromHtml(html: string, base: URL): string | null {
  const $ = cheerio.load(html);
  const link = $(
    'link[type="application/rss+xml"], link[type="application/atom+xml"]'
  ).first();
  const href = link.attr("href");
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function tryRssFeeds(url: URL, html?: string): Promise<string[]> {
  if (html) {
    const discovered = discoverFeedUrlFromHtml(html, url);
    if (discovered) {
      const r = await fetchWithTimeout(discovered, "application/xml, text/xml, */*");
      if (r) {
        const xml = await r.text();
        const titles = extractHeadlinesFromFeed(xml);
        if (titles.length > 0) return titles;
      }
    }
  }

  for (const path of FEED_PATHS) {
    const feedUrl = url.origin + path;
    const r = await fetchWithTimeout(feedUrl, "application/xml, text/xml, */*");
    if (r) {
      const xml = await r.text();
      const titles = extractHeadlinesFromFeed(xml);
      if (titles.length > 0) return titles;
    }
  }

  return [];
}

interface ClassifiedHeadline {
  headline: string;
  sentiment: "positive" | "negative" | "neutral";
}

async function classifyHeadlines(
  headlines: string[]
): Promise<ClassifiedHeadline[]> {
  const numbered = headlines
    .map((h, i) => `${i + 1}. ${h}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Classify each news headline as "positive", "negative", or "neutral".

Positive: good news, progress, achievement, joy, solutions, kindness.
Negative: bad news, conflict, disaster, crime, fear, loss.
Neutral: factual reporting without clear positive or negative framing.

Headlines:
${numbered}

Respond with ONLY a JSON array of objects, each with "index" (1-based) and "sentiment". Example:
[{"index":1,"sentiment":"positive"},{"index":2,"sentiment":"negative"}]`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return headlines.map((h) => ({ headline: h, sentiment: "neutral" }));
  }

  const parsed: { index: number; sentiment: string }[] = JSON.parse(match[0]);
  return headlines.map((headline, i) => {
    const entry = parsed.find((p) => p.index === i + 1);
    const sentiment =
      entry && ["positive", "negative", "neutral"].includes(entry.sentiment)
        ? (entry.sentiment as "positive" | "negative" | "neutral")
        : "neutral";
    return { headline, sentiment };
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (isRateLimited(clientIp)) {
    return res
      .status(429)
      .json({ error: "Too many requests. Please wait a minute and try again." });
  }

  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }

  const url = isValidPublicUrl(rawUrl);
  if (!url) {
    return res
      .status(400)
      .json({ error: "Invalid or non-public URL" });
  }

  const cacheKey = url.origin + url.pathname;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  let headlines: string[] = [];
  let html: string | undefined;
  let fetchFailed = false;

  const pageResponse = await fetchWithTimeout(url.toString(), "text/html");
  if (pageResponse) {
    html = await pageResponse.text();
    headlines = extractHeadlines(html);
  } else {
    fetchFailed = true;
  }

  if (headlines.length === 0) {
    const rssHeadlines = await tryRssFeeds(url, html);
    if (rssHeadlines.length > 0) {
      headlines = rssHeadlines;
    }
  }

  if (headlines.length === 0) {
    const msg = fetchFailed
      ? "This site blocks automated access and no RSS feed was found."
      : "No headlines found on the page and no RSS feed was found.";
    return res.status(422).json({ error: msg });
  }

  try {
    const classified = await classifyHeadlines(headlines);

    const positive = classified.filter((h) => h.sentiment === "positive").length;
    const negative = classified.filter((h) => h.sentiment === "negative").length;
    const neutral = classified.filter((h) => h.sentiment === "neutral").length;
    const total = classified.length;
    const score = Math.round((positive / total) * 100);

    const result = {
      url: url.toString(),
      score,
      total,
      breakdown: { positive, negative, neutral },
      headlines: classified,
    };
    setCache(cacheKey, result);
    return res.status(200).json(result);
  } catch (e) {
    return res
      .status(500)
      .json({ error: "Headline classification failed" });
  }
}
