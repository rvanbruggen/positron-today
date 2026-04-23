/**
 * Generate the three social-profile banners in one pass:
 *
 *   • branding/social-banner-facebook-820x312.png  (Facebook cover)
 *   • branding/social-banner-twitter-1500x500.png  (X / Twitter header)
 *   • branding/social-banner-bluesky-3000x1000.png (Bluesky header)
 *
 * Single parameterised layout — content is sized relative to banner
 * height so all three variants share the exact same visual identity at
 * different resolutions and aspect ratios.
 *
 * Why the layout differs from the previous single-size script:
 * Facebook crops the sides of the cover image on mobile (safe visible
 * area is roughly the centre 2:1 block). The previous banner placed
 * "positron.today" in the top-right corner — which disappears on Facebook
 * mobile. The rebuilt layout centres the whole content stack (atom +
 * wordmark + tagline + URL) horizontally, keeps every essential element
 * inside a 2:1 centred safe zone, and reserves the wider space on the
 * 3:1 Twitter / Bluesky exports for breathing room rather than for
 * load-bearing text.
 *
 * Pipeline is the same satori + sharp pipeline as the Instagram card
 * generator. Fonts: Playfair Display 900 for the wordmark, Inter 500/700
 * for the tagline + URL.
 *
 * Run: cd admin && node scripts/generate-social-banners.mjs
 */

import satori from "satori";
import sharp from "sharp";
import React from "react";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRANDING_DIR = join(__dirname, "..", "..", "branding");

const VARIANTS = [
  { platform: "facebook", width: 820,  height: 312  },
  { platform: "twitter",  width: 1500, height: 500  },
  { platform: "bluesky",  width: 3000, height: 1000 },
];

// ─── Font loading (same pattern as instagram-card-og.tsx) ────────────────────

async function loadGoogleFont(family, weights) {
  const results = [];
  for (const weight of weights) {
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&display=swap`;
    const css = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.text());
    const match = css.match(/src:\s*url\(([^)]+)\)/);
    if (match?.[1]) {
      const fontData = await fetch(match[1], { signal: AbortSignal.timeout(10000) })
        .then((r) => r.arrayBuffer());
      results.push({ name: family, data: fontData, weight, style: "normal" });
    }
  }
  return results;
}

// ─── Atom mark (bright variant) as an inline SVG data URI ────────────────────

const atomSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5"/>
  <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(60 50 50)"/>
  <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(120 50 50)"/>
  <circle cx="50" cy="50" r="18" fill="#f59e0b" opacity="0.18"/>
  <circle cx="50" cy="50" r="13" fill="#f59e0b"/>
  <rect x="43.5" y="47" width="13" height="6" rx="2" fill="white" opacity="0.95"/>
  <rect x="47" y="43.5" width="6" height="13" rx="2" fill="white" opacity="0.95"/>
</svg>`;
const atomDataUri = `data:image/svg+xml;base64,${Buffer.from(atomSvg).toString("base64")}`;

// ─── Banner JSX — parameterised by height so the same layout renders ─────────
//     identically across 312px, 500px, and 1000px tall canvases.

const h = React.createElement;

function Banner({ width, height }) {
  // Everything scales relative to banner height — keeps proportions identical
  // across the three variants. Tuned so the full content stack (atom + text)
  // fits inside a ~2.1 × H wide centre block, well within Facebook's mobile
  // safe zone of ~2.05 × H.
  const atomSize     = height * 0.56;
  const gapBetween   = height * 0.08;         // atom ↔ text block
  const wordmarkSize = height * 0.24;
  const taglineSize  = height * 0.070;
  const urlSize      = height * 0.048;
  const stackGap     = height * 0.020;        // wordmark ↔ tagline ↔ url

  return h(
    "div",
    {
      style: {
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 60%, #fde68a 100%)",
        fontFamily: "Inter",
      },
    },

    // Centred content row — atom on the left, wordmark stack on the right
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: gapBetween,
        },
      },

      // Atom mark
      h(
        "div",
        {
          style: {
            width: atomSize,
            height: atomSize,
            display: "flex",
          },
        },
        h("img", {
          src: atomDataUri,
          width: atomSize,
          height: atomSize,
          style: { width: atomSize, height: atomSize },
        }),
      ),

      // Wordmark + tagline + URL stack
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: stackGap,
          },
        },
        // Wordmark — "Positron" brown + "Today" orange
        h(
          "div",
          {
            style: {
              fontFamily: "Playfair Display",
              fontWeight: 900,
              fontSize: wordmarkSize,
              lineHeight: 1,
              color: "#78350f",
              display: "flex",
              flexDirection: "row",
              gap: wordmarkSize * 0.22,
              letterSpacing: -2,
            },
          },
          h("span", { style: { display: "flex" } }, "Positron"),
          h("span", { style: { display: "flex", color: "#f59e0b" } }, "Today"),
        ),
        // Tagline
        h(
          "div",
          {
            style: {
              fontFamily: "Inter",
              fontWeight: 500,
              fontSize: taglineSize,
              color: "#b45309",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: taglineSize * 0.45,
              marginTop: height * 0.008,
            },
          },
          h("span", { style: { display: "flex" } }, "Positive news, every day"),
          // Sparkle — satori renders emoji as tofu without an image provider,
          // so we draw the shape ourselves.
          h(
            "svg",
            {
              xmlns: "http://www.w3.org/2000/svg",
              viewBox: "0 0 32 32",
              width: taglineSize * 1.1,
              height: taglineSize * 1.1,
              style: { display: "flex" },
            },
            h("path", {
              fill: "#f59e0b",
              d: "M16 2 L17.8 12.2 L28 14 L17.8 15.8 L16 26 L14.2 15.8 L4 14 L14.2 12.2 Z",
            }),
            h("path", {
              fill: "#fbbf24",
              opacity: 0.85,
              d: "M25 4 L25.8 7.2 L29 8 L25.8 8.8 L25 12 L24.2 8.8 L21 8 L24.2 7.2 Z",
            }),
            h("path", {
              fill: "#fbbf24",
              opacity: 0.75,
              d: "M7 20 L7.6 22.4 L10 23 L7.6 23.6 L7 26 L6.4 23.6 L4 23 L6.4 22.4 Z",
            }),
          ),
        ),
        // URL — small, inside the safe zone instead of the top-right corner
        h(
          "div",
          {
            style: {
              fontFamily: "Inter",
              fontWeight: 500,
              fontSize: urlSize,
              color: "#d97706",
              letterSpacing: 1,
              display: "flex",
              marginTop: height * 0.012,
            },
          },
          "positron.today",
        ),
      ),
    ),
  );
}

// ─── Run ─────────────────────────────────────────────────────────────────────

console.log("Loading fonts…");
const [playfair, inter] = await Promise.all([
  loadGoogleFont("Playfair Display", [900]),
  loadGoogleFont("Inter", [500, 700]),
]);
const fonts = [...playfair, ...inter];
console.log(`  Loaded ${fonts.length} font(s).`);

for (const v of VARIANTS) {
  console.log(`\n→ ${v.platform}  ${v.width}×${v.height}`);
  const svg = await satori(Banner({ width: v.width, height: v.height }), {
    width: v.width,
    height: v.height,
    fonts,
  });
  const png = await sharp(Buffer.from(svg)).png({ quality: 95 }).toBuffer();
  const outPath = join(BRANDING_DIR, `social-banner-${v.platform}-${v.width}x${v.height}.png`);
  writeFileSync(outPath, png);
  console.log(`  Wrote ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
}

console.log("\nDone.");
