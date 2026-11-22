/**
 * Digest collage image — 1080x1080 "colour tiles" grid of 3–5 articles.
 *
 * A bold headline sits above a grid of tiles. Each tile shows the article's
 * OG image cropped to a uniform frame (so nothing overlaps or gets covered),
 * above a bright colour band carrying the emoji and the title in large type.
 * Titles are sized for phone screens: 25–36px on the 1080 canvas, wrapping to
 * up to 3–4 lines instead of being cut off after a few words.
 *
 * Layouts per count (rows of tiles):
 *   3 → one wide tile on top, two below
 *   4 → 2 × 2
 *   5 → two on top, three below
 *
 * Preview via /api/post-social-digest?preview=image.
 */

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const satori = _require("satori").default as typeof import("satori")["default"];
import sharp from "sharp";
import { getFonts, prefetchImageAsDataUri, loadEmojiSvgDataUri, React } from "@/lib/card-shared";

export interface DigestArticle {
  title: string;
  emoji: string;
  imageUrl: string | null;
}

export const MIN_DIGEST_ARTICLES = 3;
export const MAX_DIGEST_ARTICLES = 5;

const CANVAS = 1080;
const GAP = 20; // outer padding and space between tiles
const HEADER_H = 80; // headline row height (below the top padding)
const HEADLINE = "The good news digest";

// Background and text colours
const PAGE_BG = "#FFF8EC";
const INK = "#1F1300";

// Band colours, cycled per tile. White text on each of the dark-enough ones
// has a contrast ratio of at least 3.8:1; the yellow band uses dark ink (10.9:1).
const PALETTE: { bg: string; fg: string }[] = [
  { bg: "#FFC83D", fg: "#2B1900" }, // sunshine yellow
  { bg: "#0E9384", fg: "#FFFFFF" }, // teal
  { bg: "#E5484D", fg: "#FFFFFF" }, // coral
  { bg: "#7C5CFF", fg: "#FFFFFF" }, // violet
  { bg: "#2672E8", fg: "#FFFFFF" }, // blue
];

// Number of tiles in each row, per article count.
const ROWS: Record<number, number[]> = {
  3: [1, 2],
  4: [2, 2],
  5: [2, 3],
};

// Embedded photos are rendered at 1.5x their displayed size: crisp enough
// for social feeds, while keeping each base64 image small so the satori SVG
// stays well under librsvg's ~10MB XML parse limit when sharp rasterizes it.
const PHOTO_SCALE = 1.5;

interface TileSpec {
  w: number;
  h: number;
  photoH: number;
  fontSize: number;
  emojiSize: number;
  maxLines: number;
  maxChars: number;
}

/** Typography and proportions per tile width (wide / half / third). */
function tileSpec(perRow: number, w: number, h: number): TileSpec {
  if (perRow === 1) {
    return { w, h, photoH: Math.round(h * 0.6), fontSize: 36, emojiSize: 48, maxLines: 2, maxChars: 90 };
  }
  if (perRow === 2) {
    return { w, h, photoH: Math.round(h * 0.55), fontSize: 29, emojiSize: 40, maxLines: 3, maxChars: 85 };
  }
  return { w, h, photoH: Math.round(h * 0.45), fontSize: 25, emojiSize: 34, maxLines: 4, maxChars: 80 };
}

function truncateTitle(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 1).trimEnd() + "…";
}

/**
 * Crop a fetched image to exactly the tile's photo frame and re-encode it as
 * a JPEG data URI. "attention" positioning keeps the most salient part of the
 * picture in frame.
 */
async function cropToFrame(dataUri: string, w: number, h: number): Promise<string> {
  const base64 = dataUri.split(",")[1];
  if (!base64) throw new Error("Invalid data URI");
  const buf = Buffer.from(base64, "base64");
  const out = await sharp(buf)
    .resize(Math.round(w * PHOTO_SCALE), Math.round(h * PHOTO_SCALE), { fit: "cover", position: "attention" })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

export async function generateDigestCollage(articles: DigestArticle[]): Promise<Buffer> {
  if (articles.length < MIN_DIGEST_ARTICLES || articles.length > MAX_DIGEST_ARTICLES) {
    throw new Error(
      `Digest collage requires ${MIN_DIGEST_ARTICLES}–${MAX_DIGEST_ARTICLES} articles, got ${articles.length}`,
    );
  }

  const fonts = await getFonts();
  const rows = ROWS[articles.length];

  // Work out each tile's size from the row layout.
  const gridH = CANVAS - GAP - HEADER_H - GAP - GAP;
  const rowH = Math.floor((gridH - GAP * (rows.length - 1)) / rows.length);
  const specs: TileSpec[] = [];
  for (const perRow of rows) {
    const w = Math.floor((CANVAS - GAP * 2 - GAP * (perRow - 1)) / perRow);
    for (let i = 0; i < perRow; i++) specs.push(tileSpec(perRow, w, rowH));
  }

  const rawDataUris = await Promise.all(
    articles.map((a) => (a.imageUrl ? prefetchImageAsDataUri(a.imageUrl) : Promise.resolve(null))),
  );

  const photos = await Promise.all(
    rawDataUris.map(async (uri, i) => {
      if (!uri) return null;
      try {
        return await cropToFrame(uri, specs[i].w, specs[i].photoH);
      } catch (err) {
        console.warn(`[digest-collage] Image ${i} processing failed, using emoji fallback:`, err instanceof Error ? err.message : err);
        return null;
      }
    }),
  );

  console.log(
    `[digest-collage] Generating colour-tile collage: count=${articles.length}, fonts=${fonts.length}, images=${photos.filter(Boolean).length}/${articles.length}`,
  );

  function tile(article: DigestArticle, photo: string | null, s: TileSpec, index: number) {
    const colour = PALETTE[index % PALETTE.length];
    return React.createElement(
      "div",
      {
        key: index,
        style: {
          width: s.w,
          height: s.h,
          display: "flex",
          flexDirection: "column" as const,
          borderRadius: 18,
          overflow: "hidden",
          background: colour.bg,
        },
      },
      photo
        ? React.createElement("img", {
            src: photo,
            alt: "",
            width: s.w,
            height: s.photoH,
            style: { width: s.w, height: s.photoH, objectFit: "cover" },
          })
        : // No image: a big emoji on a slightly darker shade of the band colour
          React.createElement(
            "div",
            {
              style: {
                width: s.w,
                height: s.photoH,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.12)",
                fontSize: Math.round(s.photoH * 0.45),
              },
            },
            article.emoji,
          ),
      // Colour band with emoji + title
      React.createElement(
        "div",
        {
          style: {
            flex: 1,
            display: "flex",
            flexDirection: "row" as const,
            alignItems: "center",
            gap: 14,
            padding: s.w > 600 ? "0 30px" : "0 20px",
          },
        },
        React.createElement(
          "div",
          { style: { fontSize: s.emojiSize, lineHeight: 1, display: "flex", flexShrink: 0 } },
          article.emoji,
        ),
        React.createElement(
          "div",
          {
            style: {
              fontFamily: "Inter",
              fontWeight: 700,
              fontSize: s.fontSize,
              lineHeight: 1.18,
              color: colour.fg,
              display: "block",
              flex: 1,
              lineClamp: s.maxLines,
            },
          },
          truncateTitle(article.title, s.maxChars),
        ),
      ),
    );
  }

  // Group tiles into rows
  let cursor = 0;
  const rowElements = rows.map((perRow, r) => {
    const children = [];
    for (let i = 0; i < perRow; i++, cursor++) {
      children.push(tile(articles[cursor], photos[cursor] ?? null, specs[cursor], cursor));
    }
    return React.createElement(
      "div",
      { key: `row-${r}`, style: { display: "flex", flexDirection: "row" as const, gap: GAP } },
      ...children,
    );
  });

  const element = React.createElement(
    "div",
    {
      style: {
        width: CANVAS,
        height: CANVAS,
        display: "flex",
        flexDirection: "column" as const,
        background: PAGE_BG,
        padding: GAP,
      },
    },
    // Header: headline + brand badge
    React.createElement(
      "div",
      {
        style: {
          height: HEADER_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 8px",
        },
      },
      React.createElement(
        "div",
        { style: { display: "flex", fontFamily: "Playfair Display", fontWeight: 900, fontSize: 52, color: INK } },
        HEADLINE,
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: INK,
            borderRadius: 999,
            padding: "10px 24px",
          },
        },
        React.createElement("span", { style: { fontSize: 22, display: "flex" } }, "⚡"),
        React.createElement(
          "span",
          {
            style: {
              fontFamily: "Inter",
              fontWeight: 700,
              fontSize: 20,
              color: "#FFE066",
              letterSpacing: "0.1em",
              display: "flex",
            },
          },
          "POSITRON TODAY",
        ),
      ),
    ),
    // Tile grid
    React.createElement(
      "div",
      { style: { display: "flex", flexDirection: "column" as const, gap: GAP, marginTop: GAP } },
      ...rowElements,
    ),
  );

  const svg = await satori(element, {
    width: CANVAS,
    height: CANVAS,
    fonts,
    loadAdditionalAsset: async (code, segment) => {
      if (code === "emoji") return await loadEmojiSvgDataUri(segment);
      return segment;
    },
  });

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  console.log(`[digest-collage] Collage generated: ${(png.byteLength / 1024).toFixed(0)} KB`);
  return png;
}
