const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');
const { Resvg } = require('@resvg/resvg-js');

/**
 * Hybrid Birthday Flyer Generator:
 *  - @resvg/resvg-js renders the full SVG design (gradients, glow rings, badges, text) → PNG buffer
 *  - jimp (pure JS) applies circular crop to the celebrant photo and composites it in
 *
 * This approach works on Pxxl Linux cloud containers:
 *  - resvg uses prebuilt NAPI binaries (not blocked by Pxxl)
 *  - jimp is 100% pure JavaScript (zero native build scripts)
 */
async function generateBirthdayFlyer({ fullName, nickname, birthDate, photoPath }) {
  const displayName = (fullName || 'ESTEEMED CELEBRANT').toUpperCase();
  const preferredName = nickname ? `"${nickname}"` : '';
  const nameLength = displayName.length;
  const nameFontSize = nameLength > 20 ? 38 : nameLength > 14 ? 44 : 52;

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Render full SVG design (without photo) → PNG buffer via resvg
  // The SVG includes gradient background, glow rings, dashed accents, text layers
  // ─────────────────────────────────────────────────────────────────────────────
  const svgDesign = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <!-- Background gradient: deep navy to slate -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1080" y2="1080" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#030712"/>
      <stop offset="45%"  stop-color="#0a1628"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- Accent gradient: cyan → indigo → purple -->
    <linearGradient id="accentGrad" x1="0" y1="0" x2="1080" y2="1080" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#22d3ee"/>
      <stop offset="50%"  stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>

    <!-- Gold gradient for header text -->
    <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#fbbf24"/>
      <stop offset="50%"  stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>

    <!-- Glow filter for rings -->
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <!-- Clip for circular photo -->
    <clipPath id="photoClip">
      <circle cx="540" cy="500" r="200"/>
    </clipPath>
  </defs>

  <!-- ── BACKGROUND ── -->
  <rect width="1080" height="1080" fill="url(#bgGrad)"/>

  <!-- ── SUBTLE CORNER ACCENTS ── -->
  <circle cx="0"    cy="0"    r="280" fill="none" stroke="#22d3ee" stroke-width="1" opacity="0.08"/>
  <circle cx="1080" cy="1080" r="280" fill="none" stroke="#a855f7" stroke-width="1" opacity="0.08"/>

  <!-- ── HEADER BADGE ── -->
  <rect x="160" y="40" width="760" height="58" rx="29"
        fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
  <text x="540" y="78"
        font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
        font-size="21" font-weight="bold" fill="#22d3ee"
        text-anchor="middle" letter-spacing="3">INFORMATION TECHNOLOGY 25/26 SET</text>

  <!-- ── MAIN HEADING ── -->
  <text x="540" y="148"
        font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
        font-size="64" font-weight="bold" fill="#ffffff"
        text-anchor="middle">HAPPY BIRTHDAY!</text>

  <!-- ── GLOW RINGS around photo ── -->
  <circle cx="540" cy="500" r="320" fill="none" stroke="#22d3ee" stroke-width="1.5" opacity="0.12"/>
  <circle cx="540" cy="500" r="278" fill="none" stroke="#6366f1" stroke-width="1"   opacity="0.20"/>
  <circle cx="540" cy="500" r="248" fill="none" stroke="#818cf8"
          stroke-dasharray="14 10" stroke-width="2.5" opacity="0.35"/>

  <!-- ── PHOTO SLOT DARK BACKGROUND ── -->
  <circle cx="540" cy="500" r="200" fill="#0d1526"/>

  <!-- ── GLOWING ACCENT RING (photo border) ── -->
  <circle cx="540" cy="500" r="213" fill="none" stroke="url(#accentGrad)"
          stroke-width="9" opacity="0.95" filter="url(#glow)"/>

  <!-- ── CELEBRANT NAME ── -->
  <text x="540" y="768"
        font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
        font-size="${nameFontSize}" font-weight="bold" fill="#ffffff"
        text-anchor="middle">${displayName}</text>

  ${preferredName ? `
  <!-- ── NICKNAME ── -->
  <text x="540" y="826"
        font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
        font-size="30" font-weight="bold" fill="#22d3ee"
        text-anchor="middle">${preferredName}</text>
  ` : ''}

  <!-- Decorative divider line -->
  <line x1="260" y1="${preferredName ? 856 : 806}" x2="820" y2="${preferredName ? 856 : 806}"
        stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>

  <!-- ── BOTTOM BANNER ── -->
  <rect x="70" y="${preferredName ? 876 : 826}" width="940" height="152" rx="24"
        fill="rgba(8, 14, 30, 0.9)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>

  <text x="540" y="${preferredName ? 930 : 880}"
        font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
        font-size="22" font-weight="bold" fill="#f8fafc"
        text-anchor="middle">Wishing you a day filled with joy, peace &amp; outstanding code!</text>

  <text x="540" y="${preferredName ? 970 : 920}"
        font-family="Liberation Sans, DejaVu Sans, FreeSans, Arial, Helvetica, sans-serif"
        font-size="15" fill="#64748b"
        text-anchor="middle">Official Birthday Celebration  ·  IT Department 25/26 Set</text>
</svg>`;

  // Render SVG to PNG buffer
  const resvgInstance = new Resvg(svgDesign, {
    fitTo: { mode: 'width', value: 1080 },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Liberation Sans'
    }
  });
  let pngBuffer = resvgInstance.render().asPng();

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Composite circular photo using jimp (pure JS)
  // Photo center in SVG: cx=540, cy=422, r=200 → top-left at (340, 222)
  // ─────────────────────────────────────────────────────────────────────────────
  if (photoPath && fs.existsSync(photoPath)) {
    try {
      const PHOTO_D = 400;
      const CX = 340;      // left = 540 - 200
      const CY = 300;      // top  = 500 - 200

      const bgImg = await Jimp.read(pngBuffer);
      const photo = await Jimp.read(photoPath);

      // Resize photo to cover the circle area
      photo.cover(PHOTO_D, PHOTO_D);

      // Apply circular mask by scanning pixels
      const r = PHOTO_D / 2;
      photo.scan(0, 0, PHOTO_D, PHOTO_D, function (x, y, idx) {
        const dx = x - r;
        const dy = y - r;
        if (Math.sqrt(dx * dx + dy * dy) > r) {
          this.bitmap.data[idx + 3] = 0; // transparent outside circle
        }
      });

      // Composite photo onto background
      bgImg.composite(photo, CX, CY);
      pngBuffer = await bgImg.getBufferAsync(Jimp.MIME_PNG);

      console.log('✅ Celebrant photo composited onto flyer.');
    } catch (photoErr) {
      console.warn('⚠️ Could not composite photo onto flyer:', photoErr.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Save final PNG
  // ─────────────────────────────────────────────────────────────────────────────
  const flyerDir = path.join(__dirname, 'public', 'flyers');
  if (!fs.existsSync(flyerDir)) {
    fs.mkdirSync(flyerDir, { recursive: true });
  }

  const flyerFilename = `flyer-${Date.now()}-${Math.round(Math.random() * 9999)}.png`;
  const flyerPath = path.join(flyerDir, flyerFilename);
  fs.writeFileSync(flyerPath, pngBuffer);

  console.log(`✅ Hybrid Birthday Flyer PNG generated: ${flyerFilename} (${Math.round(pngBuffer.length / 1024)}KB)`);
  return flyerPath;
}

module.exports = { generateBirthdayFlyer };
