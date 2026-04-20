/**
 * Generate a 1500×500 profile banner for Bluesky and X (both platforms
 * use this exact size). The output is loss-lessly suitable for either;
 * upload the same file to both profiles.
 *
 * Uses satori + sharp (the same pipeline as the Instagram card
 * generator), so the wordmark renders with Playfair Display and the
 * tagline with Inter — matching the visual identity the site already
 * uses in its social cards.
 *
 * Layout (left-to-right, 1500×500):
 *   • Cream background with a subtle diagonal gradient
 *   • Large atom mark on the left (the bright/public variant)
 *   • Wordmark "Positron Today" in Playfair Display 900
 *   • Tagline "Positive news, every day ✨" in Inter 500
 *   • "positron.today" URL in the top-right
 *
 * Safe zones:
 *   • Keep meaningful content inside 150px margins (X crops the edges
 *     on narrow viewports)
 *   • Bottom-left ~260×180 avoided — that's where X overlays the round
 *     profile picture. Bluesky shows the avatar under the banner so this
 *     is belt-and-braces, but costs nothing.
 *
 * Run: cd admin && node scripts/generate-social-banner.mjs
 * Output: ../branding/social-banner-1500x500.png
 */

import satori from "satori";
import sharp from "sharp";
import React from "react";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "..", "branding", "social-banner-1500x500.png");

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

// ─── Atom mark as inline SVG (bright variant) ────────────────────────────────

const atomSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="340" height="340">
  <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5"/>
  <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(60 50 50)"/>
  <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(120 50 50)"/>
  <circle cx="50" cy="50" r="18" fill="#f59e0b" opacity="0.18"/>
  <circle cx="50" cy="50" r="13" fill="#f59e0b"/>
  <rect x="43.5" y="47" width="13" height="6" rx="2" fill="white" opacity="0.95"/>
  <rect x="47" y="43.5" width="6" height="13" rx="2" fill="white" opacity="0.95"/>
</svg>`;
const atomDataUri = `data:image/svg+xml;base64,${Buffer.from(atomSvg).toString("base64")}`;

// ─── Banner JSX (via React.createElement to avoid needing a JSX build step) ──

const h = React.createElement;

function Banner() {
  return h(
    "div",
    {
      style: {
        width: 1500,
        height: 500,
        display: "flex",
        position: "relative",
        // Diagonal gradient — warm cream top-left, slightly peachier bottom-right
        background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 60%, #fde68a 100%)",
        fontFamily: "Inter",
      },
    },

    // Faint decorative orbital — large and offset to the right, reads as a watermark
    h(
      "div",
      {
        style: {
          position: "absolute",
          top: -120, right: -180,
          width: 780, height: 780,
          display: "flex",
          opacity: 0.12,
        },
      },
      h("img", {
        src: atomDataUri,
        width: 780, height: 780,
        style: { width: 780, height: 780 },
      }),
    ),

    // Primary atom mark — left, vertically centred
    h(
      "div",
      {
        style: {
          position: "absolute",
          top: 80, left: 140,
          width: 340, height: 340,
          display: "flex",
        },
      },
      h("img", {
        src: atomDataUri,
        width: 340, height: 340,
        style: { width: 340, height: 340 },
      }),
    ),

    // Wordmark + tagline block — right of the atom
    h(
      "div",
      {
        style: {
          position: "absolute",
          top: 140, left: 540,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        },
      },
      h(
        "div",
        {
          style: {
            fontFamily: "Playfair Display",
            fontWeight: 900,
            fontSize: 120,
            lineHeight: 1,
            color: "#78350f",
            display: "flex",
            flexDirection: "row",
            gap: 30,
            letterSpacing: -2,
          },
        },
        h("span", { style: { display: "flex" } }, "Positron"),
        h("span", { style: { display: "flex", color: "#f59e0b" } }, "Today"),
      ),
      h(
        "div",
        {
          style: {
            fontFamily: "Inter",
            fontWeight: 500,
            fontSize: 32,
            color: "#b45309",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            marginTop: 4,
          },
        },
        h("span", { style: { display: "flex" } }, "Positive news, every day"),
        // Sparkle rendered as an inline SVG — satori renders emoji as tofu
        // without an explicit image provider, and the simplest fix here is
        // to draw the shape ourselves.
        h("svg", {
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 32 32",
          width: 34,
          height: 34,
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
    ),

    // URL, top-right corner
    h(
      "div",
      {
        style: {
          position: "absolute",
          top: 40, right: 60,
          display: "flex",
          fontFamily: "Inter",
          fontWeight: 500,
          fontSize: 22,
          color: "#d97706",
          letterSpacing: 1,
        },
      },
      "positron.today",
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

console.log("Rendering SVG via satori…");
const svg = await satori(Banner(), {
  width: 1500,
  height: 500,
  fonts,
});

console.log("Converting to PNG via sharp…");
const png = await sharp(Buffer.from(svg)).png({ quality: 95 }).toBuffer();
writeFileSync(OUT_PATH, png);

console.log(`Done: ${OUT_PATH} (${(png.length / 1024).toFixed(1)} KB)`);
