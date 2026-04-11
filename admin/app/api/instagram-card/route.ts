import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── HTML card template ────────────────────────────────────────────────────────

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

  // Escape for HTML
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

  /* ── Hero image area (top 62%) ── */
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

  /* Fallback when no image — show big emoji */
  .hero-emoji {
    font-size: 200px;
    line-height: 1;
    opacity: 0.35;
    user-select: none;
  }

  /* ── Gradient overlay bridging image → content ── */
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

  /* ── Text content ── */
  .content {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 0 54px 52px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .content-emoji {
    font-size: 58px;
    line-height: 1;
  }

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

  /* ── Branding pill (top-right) ── */
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

  <div class="hero">
    ${imageSection}
  </div>

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

// ── API route ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Fetch article from DB
  const result = await db.execute({
    sql: `SELECT title_en, title_nl, article_emoji, source_name, image_url
          FROM articles WHERE id = ? AND status = 'published'`,
    args: [id],
  });

  const row = result.rows[0];
  if (!row) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const title    = String(row.title_en ?? row.title_nl ?? "");
  const emoji    = String(row.article_emoji ?? "✨");
  const source   = String(row.source_name ?? "");
  const imageUrl = row.image_url ? String(row.image_url) : null;

  // Write temp HTML
  const stamp   = `${id}-${Date.now()}`;
  const tmpHtml = join(tmpdir(), `positron-ig-${stamp}.html`);
  const tmpPng  = join(tmpdir(), `positron-ig-${stamp}.png`);

  // Script lives at repo-root/scripts/gen-instagram-card.py
  // process.cwd() inside Next.js is the /admin directory
  const scriptPath = join(process.cwd(), "..", "scripts", "gen-instagram-card.py");

  writeFileSync(tmpHtml, generateCardHtml({ title, emoji, source, imageUrl }), "utf-8");

  // Extend PATH so child_process can find python3 (homebrew / conda / pyenv paths)
  const extendedEnv = {
    ...process.env,
    PATH: [
      process.env.PATH,
      "/opt/homebrew/bin",
      "/opt/homebrew/Caskroom/miniforge/base/bin",
      "/usr/local/bin",
    ].filter(Boolean).join(":"),
  };

  try {
    execSync(`python3 "${scriptPath}" --input "${tmpHtml}" --output "${tmpPng}"`, {
      timeout: 30_000,
      env: extendedEnv,
    });

    const png  = readFileSync(tmpPng);
    const slug = title.toLowerCase().replace(/[^\w]+/g, "-").slice(0, 50).replace(/-$/, "");

    return new NextResponse(png, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="positron-${slug}.png"`,
      },
    });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    console.error("Instagram card generation failed:", e?.message);
    if (e?.stderr) console.error("stderr:", e.stderr.toString());
    if (e?.stdout) console.error("stdout:", e.stdout.toString());
    return NextResponse.json({ error: "Card generation failed" }, { status: 500 });
  } finally {
    try { unlinkSync(tmpHtml); } catch { /* ignore */ }
    try { unlinkSync(tmpPng);  } catch { /* ignore */ }
  }
}
