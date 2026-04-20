/**
 * Generate PWA icons for the PUBLIC positron.today site.
 *
 * Uses the Positron atom mark — three orbital ellipses + gold nucleus with
 * a white plus. Same geometry as the admin nav bar's inline SVG, rendered
 * on a cream background for the bright / public-facing variant. The admin
 * PWA uses a separate dark-background version; don't confuse the two.
 *
 * The mark is rendered inside a safe-zone of 76-436 on a 512×512 canvas
 * (~15% padding on every side) so Android's adaptive-icon mask can crop
 * to a circle without clipping the outer orbitals.
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

// Bright-atom mark. 100×100 viewBox from the admin nav, scaled + centred
// into a 360×360 safe zone on the 512 canvas. The nucleus has a subtle
// halo via opacity — matches how the mark reads at larger sizes.
const svgTemplate = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <rect width="512" height="512" fill="#fffbeb"/>
  <g transform="translate(76 76) scale(3.6)">
    <!-- Three orbital ellipses, rotated 0° / 60° / 120° -->
    <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5"/>
    <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(60 50 50)"/>
    <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(120 50 50)"/>
    <!-- Subtle nucleus halo so the core reads at small sizes -->
    <circle cx="50" cy="50" r="18" fill="#f59e0b" opacity="0.18"/>
    <!-- Solid nucleus -->
    <circle cx="50" cy="50" r="13" fill="#f59e0b"/>
    <!-- White plus sign -->
    <rect x="43.5" y="47" width="13" height="6" rx="2" fill="white" opacity="0.95"/>
    <rect x="47" y="43.5" width="6" height="13" rx="2" fill="white" opacity="0.95"/>
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
