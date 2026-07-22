const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const W = 1080;
const H = 1080;

/**
 * Dynamic Birthday Flyer Generator
 * Uses `sharp` (libvips + librsvg) for robust server-side PNG image generation.
 * Approach:
 *   1. Render SVG background design (no photo) to PNG buffer via sharp
 *   2. If photo exists: resize to circle, composite onto design
 *   3. Composite SVG text overlay (librsvg reads system fonts via fontconfig)
 *   4. Save final 1080x1080 PNG to disk
 */
async function generateBirthdayFlyer({ fullName, nickname, birthDate, photoPath }) {
  const displayName = (fullName || 'ESTEEMED CELEBRANT').toUpperCase();
  const preferredName = nickname ? `&quot;${nickname}&quot;` : '';
  const nameLength = displayName.length;
  const nameFontSize = nameLength > 18 ? 34 : nameLength > 14 ? 40 : 46;

  // ─── STEP 1: Background & Design layer (shapes only, no text) ───────────────
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#050811"/>
        <stop offset="50%" stop-color="#0b111f"/>
        <stop offset="100%" stop-color="#111827"/>
      </linearGradient>
      <linearGradient id="ac" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#38bdf8"/>
        <stop offset="50%" stop-color="#6366f1"/>
        <stop offset="100%" stop-color="#a855f7"/>
      </linearGradient>
    </defs>

    <!-- Background -->
    <rect width="${W}" height="${H}" fill="url(#bg)"/>

    <!-- Outer glow ring -->
    <circle cx="540" cy="450" r="320" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.22"/>
    <!-- Dashed ring -->
    <circle cx="540" cy="450" r="260" fill="none" stroke="#818cf8" stroke-dasharray="12 12" stroke-width="3" opacity="0.32"/>
    <!-- Photo slot background -->
    <circle cx="540" cy="450" r="210" fill="#1a2235"/>
    <!-- Gradient border ring -->
    <circle cx="540" cy="450" r="222" fill="none" stroke="url(#ac)" stroke-width="8"/>

    <!-- Header badge pill -->
    <rect x="190" y="72" width="700" height="54" rx="27" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>

    <!-- Bottom message banner -->
    <rect x="80" y="828" width="920" height="148" rx="24" fill="rgba(8,12,22,0.88)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
  </svg>`;

  let baseBuffer = await sharp(Buffer.from(bgSvg))
    .png()
    .toBuffer();

  // ─── STEP 2: Composite celebrant photo (circular crop) ──────────────────────
  if (photoPath && fs.existsSync(photoPath)) {
    try {
      const PHOTO_D = 420; // diameter
      const PHOTO_R = PHOTO_D / 2;

      // Circular mask SVG
      const maskSvg = `<svg width="${PHOTO_D}" height="${PHOTO_D}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${PHOTO_R}" cy="${PHOTO_R}" r="${PHOTO_R}" fill="white"/>
      </svg>`;

      const circularPhoto = await sharp(photoPath)
        .resize(PHOTO_D, PHOTO_D, { fit: 'cover', position: 'attention' })
        .composite([{
          input: Buffer.from(maskSvg),
          blend: 'dest-in'
        }])
        .png()
        .toBuffer();

      // Composite photo onto base at (left=330, top=240) — centered in ring
      baseBuffer = await sharp(baseBuffer)
        .composite([{
          input: circularPhoto,
          left: 330,
          top: 240
        }])
        .png()
        .toBuffer();

      console.log('✅ Celebrant photo composited onto flyer.');
    } catch (photoErr) {
      console.warn('⚠️ Could not composite photo onto flyer:', photoErr.message);
    }
  } else {
    // No photo — add birthday cake emoji area as text overlay
    console.log('ℹ️ No photo found. Using cake placeholder for flyer.');
  }

  // ─── STEP 3: Text overlay via SVG (librsvg reads system fonts) ──────────────
  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <!-- Header badge text -->
    <text x="540" y="108"
      font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
      font-size="19" font-weight="bold" fill="#38bdf8"
      text-anchor="middle" letter-spacing="2">INFORMATION TECHNOLOGY 25/26 SET</text>

    <!-- HAPPY BIRTHDAY heading -->
    <text x="540" y="182"
      font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
      font-size="54" font-weight="bold" fill="#ffffff"
      text-anchor="middle">HAPPY BIRTHDAY!</text>

    ${!photoPath || !fs.existsSync(photoPath || '') ? `
    <!-- Cake placeholder text (no photo) -->
    <text x="540" y="490"
      font-family="Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif"
      font-size="100" fill="#38bdf8" text-anchor="middle">*</text>
    ` : ''}

    <!-- Celebrant Name -->
    <text x="540" y="732"
      font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
      font-size="${nameFontSize}" font-weight="bold" fill="#ffffff"
      text-anchor="middle">${displayName}</text>

    ${preferredName ? `
    <!-- Nickname -->
    <text x="540" y="784"
      font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
      font-size="30" font-weight="bold" fill="#38bdf8"
      text-anchor="middle">${preferredName}</text>
    ` : ''}

    <!-- Banner line 1 -->
    <text x="540" y="882"
      font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
      font-size="21" font-weight="bold" fill="#f8fafc"
      text-anchor="middle">Wishing you a year filled with success, peace and outstanding code!</text>

    <!-- Banner line 2 -->
    <text x="540" y="926"
      font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
      font-size="15" fill="#94a3b8"
      text-anchor="middle">Official Birthday Celebration  *  IT Department 25/26 Set</text>
  </svg>`;

  const finalBuffer = await sharp(baseBuffer)
    .composite([{
      input: Buffer.from(textSvg),
      top: 0,
      left: 0
    }])
    .png()
    .toBuffer();

  // ─── STEP 4: Save PNG to disk ────────────────────────────────────────────────
  const flyerDir = path.join(__dirname, 'public', 'flyers');
  if (!fs.existsSync(flyerDir)) {
    fs.mkdirSync(flyerDir, { recursive: true });
  }

  const flyerFilename = `flyer-${Date.now()}-${Math.round(Math.random() * 9999)}.png`;
  const flyerPath = path.join(flyerDir, flyerFilename);
  fs.writeFileSync(flyerPath, finalBuffer);

  console.log(`✅ Birthday Flyer PNG generated: ${flyerFilename} (${Math.round(finalBuffer.length / 1024)}KB)`);
  return flyerPath;
}

module.exports = { generateBirthdayFlyer };
