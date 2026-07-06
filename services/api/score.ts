import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";

const client = new Anthropic();

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

  let html: string;
  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PositronScorer/1.0; +https://positron.today)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return res
        .status(502)
        .json({ error: `Failed to fetch site: HTTP ${response.status}` });
    }
    html = await response.text();
  } catch (e) {
    return res
      .status(502)
      .json({ error: "Failed to fetch the target site" });
  }

  const headlines = extractHeadlines(html);
  if (headlines.length === 0) {
    return res
      .status(422)
      .json({ error: "No headlines found on the page" });
  }

  try {
    const classified = await classifyHeadlines(headlines);

    const positive = classified.filter((h) => h.sentiment === "positive").length;
    const negative = classified.filter((h) => h.sentiment === "negative").length;
    const neutral = classified.filter((h) => h.sentiment === "neutral").length;
    const total = classified.length;
    const score = Math.round((positive / total) * 100);

    return res.status(200).json({
      url: url.toString(),
      score,
      total,
      breakdown: { positive, negative, neutral },
      headlines: classified,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ error: "Headline classification failed" });
  }
}
