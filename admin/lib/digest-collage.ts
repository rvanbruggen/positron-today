/**
 * Digest collage image — 1080x1080 triptych of 3 article OG images.
 *
 * Layout: 3 equal vertical panels (each 352px wide with 12px gaps),
 * each showing the article's OG image with a gradient overlay at the
 * bottom containing the emoji + title. Amber/gold borders and branding
 * badge match the existing single-article Instagram cards.
 */

import satori from "satori";
import sharp from "sharp";
import { getFonts, prefetchImageAsDataUri, loadEmojiSvgDataUri, React } from "@/lib/card-shared";

export interface DigestArticle {
  title: string;
  emoji: string;
  imageUrl: string | null;
}

function truncateTitle(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 1) + "…";
}

export async function generateDigestCollage(articles: DigestArticle[]): Promise<Buffer> {
  if (articles.length !== 3) throw new Error(`Digest collage requires exactly 3 articles, got ${articles.length}`);

  const fonts = await getFonts();

  const heroDataUris = await Promise.all(
    articles.map((a) => a.imageUrl ? prefetchImageAsDataUri(a.imageUrl) : Promise.resolve(null)),
  );

  console.log(`[digest-collage] Generating collage: fonts=${fonts.length}, images=${heroDataUris.filter(Boolean).length}/3`);

  const PANEL_W = 340;
  const GAP = 10;
  const BORDER = 8;
  const INNER_BORDER = 2;
  const INSET = BORDER + 3 + INNER_BORDER;

  function panel(article: DigestArticle, heroUri: string | null, index: number) {
    const left = INSET + index * (PANEL_W + GAP);
    const top = INSET;
    const height = 1080 - INSET * 2;

    return React.createElement(
      "div",
      {
        key: index,
        style: {
          position: "absolute",
          left, top,
          width: PANEL_W,
          height,
          display: "flex",
          flexDirection: "column" as const,
          overflow: "hidden",
          borderRadius: 12,
          background: "linear-gradient(135deg, #78350f 0%, #1a0800 100%)",
        },
      },
      // Hero image or emoji fallback (top portion)
      React.createElement(
        "div",
        {
          style: {
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
          },
        },
        heroUri
          ? React.createElement("img", {
              src: heroUri,
              alt: "",
              width: PANEL_W,
              height: height - 200,
              style: { width: PANEL_W, height: height - 200, objectFit: "cover" },
            })
          : React.createElement(
              "div",
              { style: { fontSize: 120, lineHeight: 1, opacity: 0.35, display: "flex" } },
              article.emoji,
            ),
      ),
      // Gradient overlay from midway to bottom
      React.createElement("div", {
        style: {
          position: "absolute",
          left: 0, right: 0, bottom: 0,
          height: "55%",
          background: "linear-gradient(to bottom, transparent 0%, rgba(26,8,0,0.7) 40%, #1a0800 75%)",
          display: "flex",
        },
      }),
      // Title overlay at bottom
      React.createElement(
        "div",
        {
          style: {
            position: "absolute",
            left: 0, right: 0, bottom: 0,
            padding: "0 20px 28px",
            display: "flex",
            flexDirection: "column" as const,
            gap: 8,
          },
        },
        React.createElement("div", { style: { fontSize: 36, lineHeight: 1, display: "flex" } }, article.emoji),
        React.createElement(
          "div",
          {
            style: {
              fontFamily: "Playfair Display",
              fontWeight: 900,
              fontSize: 28,
              lineHeight: 1.2,
              color: "#fef9c3",
              display: "flex",
            },
          },
          truncateTitle(article.title, 80),
        ),
      ),
    );
  }

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
          border: `${BORDER}px solid #d97706`,
          display: "flex",
        },
      },
      React.createElement("div", {
        style: {
          position: "absolute",
          top: 3, left: 3, right: 3, bottom: 3,
          border: `${INNER_BORDER}px solid #fbbf24`,
          display: "flex",
        },
      }),
    ),
    // Three panels
    ...articles.map((a, i) => panel(a, heroDataUris[i], i)),
    // Branding badge (top-center)
    React.createElement(
      "div",
      {
        style: {
          position: "absolute",
          top: 24, left: "50%",
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

  const svg = await satori(element, {
    width: 1080,
    height: 1080,
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
