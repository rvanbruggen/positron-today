/**
 * Instagram card generation using Satori + Sharp.
 *
 * Uses satori to render JSX → SVG, then sharp to convert SVG → PNG.
 * Both work reliably in Vercel's Node.js serverless runtime, unlike
 * @vercel/og and next/og which require the Edge runtime.
 *
 * Fonts are cached at module level so warm invocations skip the
 * Google Fonts round-trips entirely. Hero images are pre-fetched
 * with a timeout and graceful fallback to emoji-only.
 */

import satori from "satori";
import sharp from "sharp";
import React from "react";

interface CardProps {
  title: string;
  emoji: string;
  source: string;
  imageUrl: string | null;
}

type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type FontEntry = { name: string; data: ArrayBuffer; weight: Weight; style: "normal" };

// ─── Font cache (survives warm Vercel invocations) ───────────────────────────

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

async function getFonts(): Promise<FontEntry[]> {
  if (cachedFonts) return cachedFonts;

  const [playfairFonts, interFonts] = await Promise.all([
    loadGoogleFont("Playfair Display", [900]),
    loadGoogleFont("Inter", [500, 700]),
  ]);
  cachedFonts = [...playfairFonts, ...interFonts];
  return cachedFonts;
}

// ─── Hero image pre-fetch ────────────────────────────────────────────────────

/**
 * Pre-fetch a hero image and convert to a data URI so satori doesn't
 * need to do its own fetch (which can fail silently).
 * Returns null if the image can't be fetched within the timeout.
 */
async function prefetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PositronToday/1.0)" },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < 100) return null; // too small to be a real image

    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn(`[instagram-card] Failed to prefetch hero image: ${err}`);
    return null;
  }
}

// ─── Card generation ─────────────────────────────────────────────────────────

export async function generateInstagramCardOg(opts: CardProps): Promise<Buffer> {
  const { title, emoji, source, imageUrl } = opts;

  // Load fonts (cached after first call) and pre-fetch hero image in parallel
  const [fonts, heroDataUri] = await Promise.all([
    getFonts(),
    imageUrl ? prefetchImageAsDataUri(imageUrl) : Promise.resolve(null),
  ]);

  console.log(`[instagram-card] Generating card: fonts=${fonts.length}, heroImage=${heroDataUri ? "yes" : "no (fallback to emoji)"}`);

  const element = React.createElement(
    "div",
    {
      style: {
        width: 1080,
        height: 1080,
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: "#1a0800",
      },
    },
    // Amber border
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          top: 0, left: 0, right: 0, bottom: 0,
          border: "8px solid #d97706",
          display: "flex",
        },
      },
      // Gold inner border
      React.createElement("div", {
        style: {
          position: "absolute",
          top: 9, left: 9, right: 9, bottom: 9,
          border: "2px solid #fbbf24",
          display: "flex",
        },
      }),
    ),
    // Hero section — top 62%
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          top: 0, left: 0, right: 0,
          height: "62%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "linear-gradient(135deg, #78350f 0%, #1a0800 100%)",
        },
      },
      heroDataUri
        ? React.createElement("img", {
            src: heroDataUri,
            alt: "",
            width: 1080,
            height: 670,
            style: { width: 1080, height: 670, objectFit: "cover" },
          })
        : React.createElement(
            "div",
            { style: { fontSize: 200, lineHeight: 1, opacity: 0.35, display: "flex" } },
            emoji,
          ),
    ),
    // Gradient overlay
    React.createElement("div", {
      style: {
        position: "absolute",
        top: "42%", left: 0, right: 0, bottom: 0,
        background: "linear-gradient(to bottom, transparent 0%, rgba(26,8,0,0.55) 20%, rgba(26,8,0,0.92) 42%, #1a0800 60%)",
        display: "flex",
      },
    }),
    // Content section
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          bottom: 0, left: 0, right: 0,
          padding: "0 54px 52px",
          display: "flex",
          flexDirection: "column" as const,
          gap: 14,
        },
      },
      React.createElement("div", { style: { fontSize: 58, lineHeight: 1, display: "flex" } }, emoji),
      React.createElement(
        "div",
        {
          style: {
            fontFamily: "Playfair Display",
            fontWeight: 900,
            fontSize: 58,
            lineHeight: 1.15,
            color: "#fef9c3",
            display: "flex",
          },
        },
        title,
      ),
      React.createElement(
        "div",
        {
          style: {
            fontFamily: "Inter",
            fontWeight: 500,
            fontSize: 21,
            color: "#fbbf24",
            letterSpacing: "0.04em",
            opacity: 0.85,
            display: "flex",
          },
        },
        source,
      ),
    ),
    // Branding badge
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          top: 30, right: 38,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(26,8,0,0.72)",
          border: "1.5px solid rgba(217,119,6,0.6)",
          borderRadius: 999,
          padding: "9px 20px",
        },
      },
      React.createElement("span", { style: { fontSize: 18, display: "flex" } }, "⚡"),
      React.createElement(
        "span",
        {
          style: {
            fontFamily: "Inter",
            fontWeight: 700,
            fontSize: 16,
            color: "#fef9c3",
            letterSpacing: "0.09em",
            display: "flex",
          },
        },
        "POSITRON TODAY",
      ),
    ),
  );

  const svg = await satori(element, {
    width: 1080,
    height: 1080,
    fonts,
  });

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  console.log(`[instagram-card] Card generated: ${(png.byteLength / 1024).toFixed(0)} KB`);
  return png;
}
