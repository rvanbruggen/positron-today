/**
 * DEPRECATED — replaced by instagram-card-og.tsx (@vercel/og / Satori).
 * This file used Python + Playwright to screenshot an HTML template.
 * Kept only for the side-by-side comparison route (/api/instagram-card-preview).
 * Safe to delete once the comparison is no longer needed.
 */

import { execSync }                       from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join }                           from "path";
import { tmpdir }                         from "os";

function generateCardHtml(opts: {
  title: string;
  emoji: string;
  source: string;
  imageUrl: string | null;
}): string {
  const { title, emoji, source, imageUrl } = opts;

  const imageSection = imageUrl
    ? `<img class="hero-img" src="${imageUrl}" alt="">`
    : `<div class="hero-emoji">${emoji}</div>`;

  const safeTitle  = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeSource = source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 1080px; height: 1080px;
    overflow: hidden;
    background: #1a0800;
    font-family: 'Inter', sans-serif;
  }

  .card {
    width: 1080px; height: 1080px;
    position: relative;
    overflow: hidden;
    border: 8px solid #d97706;
    outline: 2px solid #fbbf24;
    outline-offset: -17px;
  }

  .hero {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 62%;
    background: linear-gradient(135deg, #78350f 0%, #1a0800 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .hero-img {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }

  .hero-emoji {
    font-size: 200px;
    line-height: 1;
    opacity: 0.35;
    user-select: none;
  }

  .gradient {
    position: absolute;
    top: 42%; left: 0; right: 0; bottom: 0;
    background: linear-gradient(to bottom,
      transparent 0%,
      rgba(26,8,0,0.55) 20%,
      rgba(26,8,0,0.92) 42%,
      #1a0800 60%
    );
    pointer-events: none;
  }

  .content {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 0 54px 52px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .content-emoji { font-size: 58px; line-height: 1; }

  .title {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: 58px;
    line-height: 1.15;
    color: #fef9c3;
    text-shadow: 0 2px 24px rgba(0,0,0,0.6);
  }

  .source {
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 21px;
    color: #fbbf24;
    letter-spacing: 0.04em;
    opacity: 0.85;
  }

  .branding {
    position: absolute;
    top: 30px; right: 38px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(26,8,0,0.72);
    border: 1.5px solid rgba(217,119,6,0.6);
    border-radius: 999px;
    padding: 9px 20px;
    backdrop-filter: blur(6px);
  }

  .branding-bolt { font-size: 18px; }

  .branding-text {
    font-family: 'Inter', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: #fef9c3;
    letter-spacing: 0.09em;
  }
</style>
</head>
<body>
<div class="card">
  <div class="hero">${imageSection}</div>
  <div class="gradient"></div>
  <div class="content">
    <div class="content-emoji">${emoji}</div>
    <div class="title">${safeTitle}</div>
    <div class="source">${safeSource}</div>
  </div>
  <div class="branding">
    <span class="branding-bolt">⚡</span>
    <span class="branding-text">POSITRON TODAY</span>
  </div>
</div>
</body>
</html>`;
}

function resolvePython3(): string {
  const candidates = [
    "/opt/homebrew/Caskroom/miniforge/base/bin/python3",
    "/opt/homebrew/Caskroom/miniforge/base/bin/python",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
    "python3",
  ];
  for (const p of candidates) {
    try {
      execSync(`"${p}" -c "import playwright"`, { stdio: "ignore" });
      return p;
    } catch { /* not this one */ }
  }
  return "python3";
}

/**
 * Generates the Instagram card PNG for an article and returns it as a Buffer.
 */
export async function generateInstagramCardPng(opts: {
  title: string;
  emoji: string;
  source: string;
  imageUrl: string | null;
}): Promise<Buffer> {
  const stamp    = Date.now();
  const tmpHtml  = join(tmpdir(), `positron-ig-${stamp}.html`);
  const tmpPng   = join(tmpdir(), `positron-ig-${stamp}.png`);
  const script   = join(process.cwd(), "..", "scripts", "gen-instagram-card.py");
  const python3  = resolvePython3();

  writeFileSync(tmpHtml, generateCardHtml(opts), "utf-8");

  try {
    execSync(`"${python3}" "${script}" --input "${tmpHtml}" --output "${tmpPng}"`, {
      timeout: 30_000,
      env: process.env,
    });
    return readFileSync(tmpPng);
  } finally {
    try { unlinkSync(tmpHtml); } catch { /* ignore */ }
    try { unlinkSync(tmpPng);  } catch { /* ignore */ }
  }
}
