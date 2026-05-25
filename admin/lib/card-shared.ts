import React from "react";

type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type FontEntry = { name: string; data: ArrayBuffer; weight: Weight; style: "normal" };

let cachedFonts: FontEntry[] | null = null;

async function loadGoogleFont(family: string, weights: Weight[]): Promise<FontEntry[]> {
  const results: FontEntry[] = [];
  for (const weight of weights) {
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&display=swap`;
    const css = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    }).then(r => r.text());
    const match = css.match(/src:\s*url\(([^)]+)\)/);
    if (match?.[1]) {
      const fontData = await fetch(match[1], {
        signal: AbortSignal.timeout(8000),
      }).then(r => r.arrayBuffer());
      results.push({ name: family, data: fontData, weight, style: "normal" });
    }
  }
  return results;
}

export async function getFonts(): Promise<FontEntry[]> {
  if (cachedFonts) return cachedFonts;
  const [playfairFonts, interFonts] = await Promise.all([
    loadGoogleFont("Playfair Display", [900]),
    loadGoogleFont("Inter", [500, 700]),
  ]);
  cachedFonts = [...playfairFonts, ...interFonts];
  return cachedFonts;
}

export async function prefetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PositronToday/1.0)" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < 100) return null;
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn(`[card-shared] Failed to prefetch image: ${err}`);
    return null;
  }
}

const TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg";
const emojiSvgCache = new Map<string, string>();

function emojiToTwemojiCode(segment: string): string {
  const hasZwj = segment.includes("‍");
  const source = hasZwj ? segment : segment.replace(/️/g, "");
  const codepoints: string[] = [];
  for (const char of source) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) codepoints.push(cp.toString(16));
  }
  return codepoints.join("-");
}

export async function loadEmojiSvgDataUri(segment: string): Promise<string> {
  const code = emojiToTwemojiCode(segment);
  const cached = emojiSvgCache.get(code);
  if (cached) return cached;

  let svg: string;
  try {
    const res = await fetch(`${TWEMOJI_BASE}/${code}.svg`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`twemoji ${code}: HTTP ${res.status}`);
    svg = await res.text();
  } catch (err) {
    console.warn(`[card-shared] Failed to load Twemoji for ${segment} (${code}): ${err}`);
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  }

  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  emojiSvgCache.set(code, dataUri);
  return dataUri;
}

export { React };
