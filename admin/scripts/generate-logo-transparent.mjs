/**
 * Generate a transparent, high-resolution PNG of the Positron atom mark.
 *
 * Same geometry as the inline SVG in site/src/_includes/base.njk and the
 * site PWA icons in generate-site-pwa-icons.mjs, but rendered on a fully
 * transparent background — for slide decks, social cards, letterheads,
 * any context where the mark needs to sit on top of a non-cream surface.
 *
 * Lives in admin/scripts/ because sharp is already installed here.
 *
 * Run from the admin directory:
 *   node scripts/generate-logo-transparent.mjs           # default 2048×2048
 *   node scripts/generate-logo-transparent.mjs 4096      # custom size
 *
 * Output: site/src/assets/logo-transparent.png
 */

import sharp from "sharp";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "..", "site", "src", "assets");

const size = Number(process.argv[2]) || 2048;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <g transform="translate(76 76) scale(3.6)">
    <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5"/>
    <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(60 50 50)"/>
    <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(120 50 50)"/>
    <circle cx="50" cy="50" r="18" fill="#f59e0b" opacity="0.18"/>
    <circle cx="50" cy="50" r="13" fill="#f59e0b"/>
    <rect x="43.5" y="47" width="13" height="6" rx="2" fill="white" opacity="0.95"/>
    <rect x="47" y="43.5" width="6" height="13" rx="2" fill="white" opacity="0.95"/>
  </g>
</svg>`;

const buf = await sharp(Buffer.from(svg))
  .resize(size, size)
  .png()
  .toBuffer();

const path = join(outDir, "logo-transparent.png");
writeFileSync(path, buf);
console.log(`Generated logo-transparent.png at ${size}×${size} (${(buf.length / 1024).toFixed(1)} KB)`);
console.log(`→ ${path}`);
