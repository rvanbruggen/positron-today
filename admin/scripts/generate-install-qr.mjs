/**
 * Generate a branded QR code that points to positron.today/install.
 *
 * The QR itself is rendered at error-correction level H (~30% tolerance),
 * so overlaying the atom logo on the centre ~22% of the square still leaves
 * enough redundant data for any scanner to decode the URL reliably.
 *
 * Output: ../../site/src/assets/qr-install.png (used by /install page) AND
 *         ../../branding/qr-install.png       (shareable marketing asset)
 *
 * Run: cd admin && node scripts/generate-install-qr.mjs
 */

import QRCode from "qrcode";
import sharp from "sharp";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_OUT     = join(__dirname, "..", "..", "site", "src", "assets", "qr-install.png");
const BRANDING_OUT = join(__dirname, "..", "..", "branding",              "qr-install.png");

const TARGET_URL = "https://positron.today/install/";
const QR_SIZE    = 1024;                 // final PNG edge length
const LOGO_FRAC  = 0.22;                 // atom takes 22% of the QR edge
const LOGO_SIZE  = Math.round(QR_SIZE * LOGO_FRAC);
const LOGO_PAD   = Math.round(LOGO_SIZE * 0.14); // white card around the atom

// ─── Base QR ─────────────────────────────────────────────────────────────────
// margin 2 = 2 quiet-zone modules (small but standards-compliant).
// Colours match the site's amber palette instead of pure black.
const qrBuffer = await QRCode.toBuffer(TARGET_URL, {
  errorCorrectionLevel: "H",
  type: "png",
  margin: 2,
  width: QR_SIZE,
  color: {
    dark:  "#78350f", // brand amber-900
    light: "#fffbeb", // brand cream
  },
});

// ─── Atom mark overlay ───────────────────────────────────────────────────────
// White rounded-rect backdrop behind the atom so the QR data doesn't
// interfere visually. Bright-variant atom — same geometry as the PWA icon.
const overlaySvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_SIZE} ${LOGO_SIZE}" width="${LOGO_SIZE}" height="${LOGO_SIZE}">
  <!-- White card with soft shadow -->
  <rect x="0" y="0" width="${LOGO_SIZE}" height="${LOGO_SIZE}" rx="${Math.round(LOGO_SIZE * 0.18)}" fill="white"/>
  <!-- Atom geometry scaled into the card with ${LOGO_PAD}px padding -->
  <g transform="translate(${LOGO_PAD} ${LOGO_PAD}) scale(${((LOGO_SIZE - 2 * LOGO_PAD) / 100).toFixed(4)})">
    <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5"/>
    <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(60 50 50)"/>
    <ellipse cx="50" cy="50" rx="46" ry="16" fill="none" stroke="#f59e0b" stroke-width="5" transform="rotate(120 50 50)"/>
    <circle cx="50" cy="50" r="18" fill="#f59e0b" opacity="0.18"/>
    <circle cx="50" cy="50" r="13" fill="#f59e0b"/>
    <rect x="43.5" y="47" width="13" height="6" rx="2" fill="white" opacity="0.95"/>
    <rect x="47" y="43.5" width="6" height="13" rx="2" fill="white" opacity="0.95"/>
  </g>
</svg>`;

const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer();

// Composite centred.
const offset = Math.round((QR_SIZE - LOGO_SIZE) / 2);
const finalPng = await sharp(qrBuffer)
  .composite([{ input: overlayPng, top: offset, left: offset }])
  .png({ quality: 95 })
  .toBuffer();

writeFileSync(SITE_OUT, finalPng);
writeFileSync(BRANDING_OUT, finalPng);
console.log(`Generated ${SITE_OUT}     (${(finalPng.length / 1024).toFixed(1)} KB)`);
console.log(`Generated ${BRANDING_OUT} (${(finalPng.length / 1024).toFixed(1)} KB)`);
