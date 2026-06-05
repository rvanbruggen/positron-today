/**
 * Digest collage image — 1080x1080 scattered "polaroid pile" of 3–5 articles.
 *
 * Each article is rendered as a polaroid: a cream frame with a small rotation
 * and drop shadow, the article's OG image shown *in full* (sized to its own
 * aspect ratio — never cropped to a slice), and the emoji + title in the thick
 * bottom margin. Cards are arranged per count so they only kiss at the corners,
 * keeping every photo essentially fully visible. Amber/gold border and branding
 * badge match the existing single-article Instagram cards.
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
const BORDER = 8;
const INNER_BORDER = 2;
const FRAME_PAD = 16; // cream margin on top + sides of the photo
const CAPTION_H = 72; // thick polaroid bottom margin for the title
const DEFAULT_ASPECT = 1.91; // OG landscape, used when dimensions are unknown

interface Placement {
  cx: number; // center x on the 1080 canvas
  cy: number; // center y
  w: number; // polaroid frame width
  rot: number; // rotation in degrees
}

/**
 * Per-count scatter arrangements. Centers/rotations are tuned so cards overlap
 * only at the corners; preview via /api/post-social-digest?preview=image.
 */
const ARRANGEMENTS: Record<number, Placement[]> = {
  3: [
    { cx: 300, cy: 410, w: 470, rot: -7 },
    { cx: 780, cy: 380, w: 470, rot: 6 },
    { cx: 545, cy: 720, w: 470, rot: -2 },
  ],
  4: [
    { cx: 305, cy: 360, w: 450, rot: -6 },
    { cx: 775, cy: 335, w: 450, rot: 6 },
    { cx: 330, cy: 770, w: 450, rot: 5 },
    { cx: 760, cy: 775, w: 450, rot: -6 },
  ],
  5: [
    { cx: 285, cy: 295, w: 375, rot: -7 },
    { cx: 795, cy: 280, w: 375, rot: 6 },
    { cx: 540, cy: 552, w: 338, rot: -1 },
    { cx: 295, cy: 800, w: 375, rot: 5 },
    { cx: 800, cy: 805, w: 375, rot: -6 },
  ],
};

function truncateTitle(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 1) + "…";
}

/** Read intrinsic pixel dimensions from an already-fetched data URI. */
async function imageAspect(dataUri: string | null): Promise<number> {
  if (!dataUri) return DEFAULT_ASPECT;
  try {
    const base64 = dataUri.split(",")[1];
    if (!base64) return DEFAULT_ASPECT;
    const meta = await sharp(Buffer.from(base64, "base64")).metadata();
    if (meta.width && meta.height) return meta.width / meta.height;
  } catch {
    /* fall through to default */
  }
  return DEFAULT_ASPECT;
}

export async function generateDigestCollage(articles: DigestArticle[]): Promise<Buffer> {
  if (articles.length < MIN_DIGEST_ARTICLES || articles.length > MAX_DIGEST_ARTICLES) {
    throw new Error(
      `Digest collage requires ${MIN_DIGEST_ARTICLES}–${MAX_DIGEST_ARTICLES} articles, got ${articles.length}`,
    );
  }

  const fonts = await getFonts();
  const placements = ARRANGEMENTS[articles.length];

  const heroDataUris = await Promise.all(
    articles.map((a) => (a.imageUrl ? prefetchImageAsDataUri(a.imageUrl) : Promise.resolve(null))),
  );
  const aspects = await Promise.all(heroDataUris.map((uri) => imageAspect(uri)));

  console.log(
    `[digest-collage] Generating polaroid collage: count=${articles.length}, fonts=${fonts.length}, images=${heroDataUris.filter(Boolean).length}/${articles.length}`,
  );

  function polaroid(article: DigestArticle, heroUri: string | null, aspect: number, p: Placement, index: number) {
    const innerW = p.w - FRAME_PAD * 2;
    // Display the whole image, bounded so very tall photos don't blow up the pile.
    const photoMaxH = p.w * 1.05;
    const dispH = Math.min(innerW / aspect, photoMaxH);
    const dispW = Math.min(dispH * aspect, innerW);
    const frameH = FRAME_PAD + dispH + CAPTION_H;

    const left = Math.round(p.cx - p.w / 2);
    const top = Math.round(p.cy - frameH / 2);

    return React.createElement(
      "div",
      {
        key: index,
        style: {
          position: "absolute",
          left,
          top,
          width: p.w,
          height: frameH,
          transform: `rotate(${p.rot}deg)`,
          background: "#fbf7ee",
          borderRadius: 4,
          boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column" as const,
          alignItems: "center",
          paddingTop: FRAME_PAD,
        },
      },
      // Photo — shown in full, centered in the cream frame
      React.createElement(
        "div",
        {
          style: {
            width: innerW,
            height: dispH,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            background: "#2a1505",
          },
        },
        heroUri
          ? React.createElement("img", {
              src: heroUri,
              alt: "",
              width: Math.round(dispW),
              height: Math.round(dispH),
              style: { width: Math.round(dispW), height: Math.round(dispH), objectFit: "contain" },
            })
          : React.createElement(
              "div",
              { style: { fontSize: 96, lineHeight: 1, opacity: 0.5, display: "flex" } },
              article.emoji,
            ),
      ),
      // Caption in the thick bottom margin
      React.createElement(
        "div",
        {
          style: {
            width: innerW,
            height: CAPTION_H,
            display: "flex",
            flexDirection: "row" as const,
            alignItems: "center",
            gap: 8,
            paddingTop: 6,
          },
        },
        React.createElement("div", { style: { fontSize: 26, lineHeight: 1, display: "flex" } }, article.emoji),
        React.createElement(
          "div",
          {
            style: {
              fontFamily: "Playfair Display",
              fontWeight: 700,
              fontSize: 18,
              lineHeight: 1.15,
              color: "#3a1d05",
              display: "flex",
              flex: 1,
            },
          },
          truncateTitle(article.title, 50),
        ),
      ),
    );
  }

  const element = React.createElement(
    "div",
    {
      style: {
        width: CANVAS,
        height: CANVAS,
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(135deg, #3a1a05 0%, #1a0800 100%)",
      },
    },
    // Amber border
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          border: `${BORDER}px solid #d97706`,
          display: "flex",
        },
      },
      React.createElement("div", {
        style: {
          position: "absolute",
          top: 3,
          left: 3,
          right: 3,
          bottom: 3,
          border: `${INNER_BORDER}px solid #fbbf24`,
          display: "flex",
        },
      }),
    ),
    // Polaroid pile
    ...articles.map((a, i) => polaroid(a, heroDataUris[i] ?? null, aspects[i] ?? DEFAULT_ASPECT, placements[i], i)),
    // Branding badge (top-center)
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          top: 24,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(26,8,0,0.85)",
          border: "1.5px solid rgba(217,119,6,0.6)",
          borderRadius: 999,
          padding: "9px 20px",
          zIndex: 10,
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

  // Diagnostic: test each part of the element tree
  const opts = { width: CANVAS, height: CANVAS, fonts };

  // Test A: root div with gradient background
  try {
    const root = React.createElement("div", {
      style: { width: CANVAS, height: CANVAS, display: "flex", background: "linear-gradient(135deg, #3a1a05 0%, #1a0800 100%)" },
    });
    await satori(root, opts);
    console.log("[diag] A (gradient bg): PASS");
  } catch (e) { console.error("[diag] A (gradient bg): FAIL", e instanceof Error ? e.message : e); }

  // Test B: border element
  try {
    const border = React.createElement("div", {
      style: { width: CANVAS, height: CANVAS, display: "flex", position: "relative" as const },
    }, React.createElement("div", {
      style: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, border: "8px solid #d97706", display: "flex" },
    }));
    await satori(border, opts);
    console.log("[diag] B (border): PASS");
  } catch (e) { console.error("[diag] B (border): FAIL", e instanceof Error ? e.message : e); }

  // Test C: single polaroid (first article)
  try {
    const p0 = polaroid(articles[0], heroDataUris[0] ?? null, aspects[0] ?? DEFAULT_ASPECT, placements[0], 0);
    const wrap = React.createElement("div", { style: { width: CANVAS, height: CANVAS, display: "flex", position: "relative" as const } }, p0);
    await satori(wrap, opts);
    console.log("[diag] C (1 polaroid): PASS");
  } catch (e) { console.error("[diag] C (1 polaroid): FAIL", e instanceof Error ? e.message : e); }

  // Test D: branding badge
  try {
    const badge = React.createElement("div", {
      style: { width: CANVAS, height: CANVAS, display: "flex", position: "relative" as const },
    }, React.createElement("div", {
      style: { position: "absolute" as const, top: 24, display: "flex", alignItems: "center", gap: 8, background: "rgba(26,8,0,0.85)", border: "1.5px solid rgba(217,119,6,0.6)", borderRadius: 999, padding: "9px 20px" },
    }, React.createElement("span", { style: { fontSize: 18, display: "flex" } }, "test")));
    await satori(badge, opts);
    console.log("[diag] D (badge): PASS");
  } catch (e) { console.error("[diag] D (badge): FAIL", e instanceof Error ? e.message : e); }

  // Test E: all polaroids together
  try {
    const pols = articles.map((a, i) => polaroid(a, heroDataUris[i] ?? null, aspects[i] ?? DEFAULT_ASPECT, placements[i], i));
    const wrap = React.createElement("div", { style: { width: CANVAS, height: CANVAS, display: "flex", position: "relative" as const } }, ...pols);
    await satori(wrap, opts);
    console.log("[diag] E (all polaroids): PASS");
  } catch (e) { console.error("[diag] E (all polaroids): FAIL", e instanceof Error ? e.message : e); }

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
