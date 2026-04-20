/**
 * Generate PWA icons for the PUBLIC positron.today site.
 *
 * Uses the bright speech-bubble logo (gold/orange on white) — the public-
 * facing variant. The admin app uses a separate dark atom mark; don't
 * confuse the two.
 *
 * The icon is rendered at 512×512 with maskable-safe padding (content fits
 * inside the centre ~80% of the canvas so Android's adaptive-icon mask can
 * crop without clipping the speech bubble), then downscaled to each target.
 *
 * Lives in admin/scripts/ because that's where sharp is already installed;
 * writes into ../../site/src/assets/ where Eleventy passthrough picks the
 * PNGs up.
 *
 * Run: cd admin && node scripts/generate-site-pwa-icons.mjs
 */

import sharp from "sharp";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "..", "site", "src", "assets");

// Bright-variant mark. The 100×100 content is inset to 10-90 so there's a
// 10% safe-zone margin on every side when the OS crops to a circle.
const svgTemplate = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <!-- Solid cream background so the icon reads on any home-screen wallpaper -->
  <rect width="512" height="512" fill="#fffbeb"/>
  <!-- Translate + scale: map the source 100×100 logo into a safe zone that
       leaves ~12% padding on each side (content inside 64-448 of 512). -->
  <g transform="translate(64 64) scale(3.84)">
    <!-- Speech bubble body with tail at bottom-centre -->
    <path fill="#f59e0b"
      d="M15,10 L85,10 Q92,10 92,17 L92,62 Q92,70 85,70 L58,70 L50,84 L42,70 L15,70 Q8,70 8,62 L8,17 Q8,10 15,10 Z"/>
    <!-- 5-pointed star centred at 50,37 -->
    <polygon fill="white" opacity="0.92"
      points="50,20 54,31 66,32 57,39 60,51 50,44 40,51 43,39 34,32 46,31"/>
    <!-- Corner sparkle dots -->
    <circle fill="white" opacity="0.55" cx="22" cy="22" r="2.5"/>
    <circle fill="white" opacity="0.55" cx="78" cy="22" r="2.5"/>
    <circle fill="white" opacity="0.40" cx="80" cy="57" r="1.8"/>
    <circle fill="white" opacity="0.40" cx="20" cy="57" r="1.8"/>
  </g>
</svg>`;

const targets = [
  { name: "icon-192.png",         size: 192 },
  { name: "icon-512.png",         size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const t of targets) {
  const buf = await sharp(Buffer.from(svgTemplate(t.size)))
    .resize(t.size, t.size)
    .png()
    .toBuffer();
  writeFileSync(join(outDir, t.name), buf);
  console.log(`Generated ${t.name} (${(buf.length / 1024).toFixed(1)} KB)`);
}

console.log("Done.");
