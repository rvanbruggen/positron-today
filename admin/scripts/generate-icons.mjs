/**
 * Generate PWA icons from the Positron atom SVG.
 * Run: node scripts/generate-icons.mjs
 */

import sharp from "sharp";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

// Positron atom icon — amber/gold on dark background, with rounded corners baked in
const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs>
    <clipPath id="rounded">
      <rect width="512" height="512" rx="96" ry="96"/>
    </clipPath>
  </defs>
  <rect width="512" height="512" rx="96" ry="96" fill="#78350f"/>
  <g clip-path="url(#rounded)">
    <!-- Subtle radial glow -->
    <circle cx="256" cy="256" r="200" fill="#92400e" opacity="0.4"/>
    <!-- Three orbital ellipses -->
    <ellipse cx="256" cy="256" rx="190" ry="66" fill="none" stroke="#f59e0b" stroke-width="14"/>
    <ellipse cx="256" cy="256" rx="190" ry="66" fill="none" stroke="#f59e0b" stroke-width="14" transform="rotate(60 256 256)"/>
    <ellipse cx="256" cy="256" rx="190" ry="66" fill="none" stroke="#f59e0b" stroke-width="14" transform="rotate(120 256 256)"/>
    <!-- Nucleus -->
    <circle cx="256" cy="256" r="54" fill="#f59e0b"/>
    <!-- Plus sign -->
    <rect x="224" y="246" width="64" height="20" rx="5" fill="white" opacity="0.95"/>
    <rect x="246" y="224" width="20" height="64" rx="5" fill="white" opacity="0.95"/>
  </g>
</svg>`;

const sizes = [192, 512];

for (const size of sizes) {
  const buffer = await sharp(Buffer.from(svg(size)))
    .resize(size, size)
    .png()
    .toBuffer();
  const path = join(publicDir, `icon-${size}.png`);
  writeFileSync(path, buffer);
  console.log(`Generated ${path} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

// Also generate a 180x180 Apple touch icon
const appleBuffer = await sharp(Buffer.from(svg(180)))
  .resize(180, 180)
  .png()
  .toBuffer();
writeFileSync(join(publicDir, "apple-touch-icon.png"), appleBuffer);
console.log(`Generated apple-touch-icon.png (${(appleBuffer.length / 1024).toFixed(1)} KB)`);

// Favicon (32x32)
const faviconBuffer = await sharp(Buffer.from(svg(32)))
  .resize(32, 32)
  .png()
  .toBuffer();
writeFileSync(join(publicDir, "favicon.png"), faviconBuffer);
console.log(`Generated favicon.png (${(faviconBuffer.length / 1024).toFixed(1)} KB)`);

console.log("Done!");
