/**
 * Instagram card generation using @vercel/og (Satori).
 * Drop-in replacement for the Python/Playwright pipeline.
 * Works on Vercel serverless — no Python, no Playwright, no filesystem.
 */

import { ImageResponse } from "@vercel/og";

interface CardProps {
  title: string;
  emoji: string;
  source: string;
  imageUrl: string | null;
}

type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type FontEntry = { name: string; data: ArrayBuffer; weight: Weight; style: "normal" };

async function loadGoogleFont(family: string, weights: Weight[]): Promise<FontEntry[]> {
  const results: FontEntry[] = [];
  for (const weight of weights) {
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&display=swap`;
    const css = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } }).then(r => r.text());
    const match = css.match(/src:\s*url\(([^)]+)\)/);
    if (match?.[1]) {
      const fontData = await fetch(match[1]).then(r => r.arrayBuffer());
      results.push({ name: family, data: fontData, weight, style: "normal" });
    }
  }
  return results;
}

export async function generateInstagramCardOg(opts: CardProps): Promise<Buffer> {
  const { title, emoji, source, imageUrl } = opts;

  const [playfairFonts, interFonts] = await Promise.all([
    loadGoogleFont("Playfair Display", [900]),
    loadGoogleFont("Inter", [500, 700]),
  ]);

  const response = new ImageResponse(
    (
      <div
        style={{
          width: 1080,
          height: 1080,
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#1a0800",
        }}
      >
        {/* Amber border */}
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            border: "8px solid #d97706",
            display: "flex",
          }}
        >
          {/* Gold inner border */}
          <div
            style={{
              position: "absolute",
              top: 9, left: 9, right: 9, bottom: 9,
              border: "2px solid #fbbf24",
              display: "flex",
            }}
          />
        </div>

        {/* Hero section — top 62% */}
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0,
            height: "62%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            background: "linear-gradient(135deg, #78350f 0%, #1a0800 100%)",
          }}
        >
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              width={1080}
              height={670}
              style={{ width: 1080, height: 670, objectFit: "cover" }}
            />
          ) : (
            <div style={{ fontSize: 200, lineHeight: 1, opacity: 0.35, display: "flex" }}>
              {emoji}
            </div>
          )}
        </div>

        {/* Gradient overlay */}
        <div
          style={{
            position: "absolute",
            top: "42%", left: 0, right: 0, bottom: 0,
            background: "linear-gradient(to bottom, transparent 0%, rgba(26,8,0,0.55) 20%, rgba(26,8,0,0.92) 42%, #1a0800 60%)",
            display: "flex",
          }}
        />

        {/* Content section */}
        <div
          style={{
            position: "absolute",
            bottom: 0, left: 0, right: 0,
            padding: "0 54px 52px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ fontSize: 58, lineHeight: 1, display: "flex" }}>{emoji}</div>
          <div
            style={{
              fontFamily: "Playfair Display",
              fontWeight: 900,
              fontSize: 58,
              lineHeight: 1.15,
              color: "#fef9c3",
              display: "flex",
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontFamily: "Inter",
              fontWeight: 500,
              fontSize: 21,
              color: "#fbbf24",
              letterSpacing: "0.04em",
              opacity: 0.85,
              display: "flex",
            }}
          >
            {source}
          </div>
        </div>

        {/* Branding badge */}
        <div
          style={{
            position: "absolute",
            top: 30, right: 38,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(26,8,0,0.72)",
            border: "1.5px solid rgba(217,119,6,0.6)",
            borderRadius: 999,
            padding: "9px 20px",
          }}
        >
          <span style={{ fontSize: 18, display: "flex" }}>⚡</span>
          <span
            style={{
              fontFamily: "Inter",
              fontWeight: 700,
              fontSize: 16,
              color: "#fef9c3",
              letterSpacing: "0.09em",
              display: "flex",
            }}
          >
            POSITRON TODAY
          </span>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1080,
      fonts: [...playfairFonts, ...interFonts],
    },
  );

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
