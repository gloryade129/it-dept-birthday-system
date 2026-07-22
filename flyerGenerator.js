const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');
const { Resvg } = require('@resvg/resvg-js');

// Load bundled font buffer so text renders 100% reliably on Linux containers (Pxxl, Docker, Vercel)
const fontPath = path.join(__dirname, 'fonts', 'arialbd.ttf');
const fontBuffer = fs.existsSync(fontPath) ? fs.readFileSync(fontPath) : null;

/**
 * 1080x1080 Dynamic Birthday Flyer Generator
 *  - resvg renders full SVG design (gradients, glow rings, text layers via bundled TTF font)
 *  - Jimp crops celebrant photo to circle and composites it onto the frame
 *  - Displays stylish initials emblem if photo is not uploaded/available
 */
async function generateBirthdayFlyer({ fullName, nickname, birthDate, photoPath }) {
  const nameStr = (fullName || 'ESTEEMED CELEBRANT').trim();
  const displayName = nameStr.toUpperCase();
  const preferredName = nickname ? `"${nickname.trim()}"` : '';

  // Get initials (e.g., "Glory Adeniran" -> "GA")
  const parts = nameStr.split(' ').filter(Boolean);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts.length === 1 ? parts[0].substring(0, 2).toUpperCase() : 'IT';

  // Dynamic font size for name length
  const nameLength = displayName.length;
  const nameFontSize = nameLength > 22 ? 36 : nameLength > 16 ? 42 : 50;

  // Resolve absolute photo path
  let resolvedPhotoPath = null;
  if (photoPath) {
    if (path.isAbsolute(photoPath) && fs.existsSync(photoPath)) {
      resolvedPhotoPath = photoPath;
    } else {
      const relativeClean = photoPath.replace(/^[/\\]+/, '');
      const candidatePath = path.join(__dirname, 'public', relativeClean);
      if (fs.existsSync(candidatePath)) {
        resolvedPhotoPath = candidatePath;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SVG DESIGN (Rendered with bundled Arial Bold TTF font)
  // ─────────────────────────────────────────────────────────────────────────────
  const svgDesign = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1080" y2="1080" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#030712"/>
      <stop offset="45%"  stop-color="#0a1628"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- Glowing Accent Gradient -->
    <linearGradient id="accentGrad" x1="0" y1="0" x2="1080" y2="1080" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#22d3ee"/>
      <stop offset="50%"  stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>

    <!-- Initials Avatar Gradient -->
    <linearGradient id="avatarGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- Glow Filter -->
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- ── BACKGROUND ── -->
  <rect width="1080" height="1080" fill="url(#bgGrad)"/>

  <!-- Corner Accents -->
  <circle cx="0"    cy="0"    r="300" fill="none" stroke="#22d3ee" stroke-width="1.5" opacity="0.08"/>
  <circle cx="1080" cy="1080" r="300" fill="none" stroke="#a855f7" stroke-width="1.5" opacity="0.08"/>

  <!-- ── HEADER BADGE ── -->
  <rect x="160" y="45" width="760" height="54" rx="27"
        fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
  <text x="540" y="81"
        font-family="Arial, sans-serif"
        font-size="20" font-weight="bold" fill="#22d3ee"
        text-anchor="middle" letter-spacing="3">INFORMATION TECHNOLOGY 25/26 SET</text>

  <!-- ── MAIN HEADING ── -->
  <text x="540" y="152"
        font-family="Arial, sans-serif"
        font-size="62" font-weight="bold" fill="#ffffff"
        text-anchor="middle">HAPPY BIRTHDAY!</text>

  <!-- ── GLOW RINGS AROUND PHOTO (cx=540, cy=500, r=200) ── -->
  <circle cx="540" cy="500" r="310" fill="none" stroke="#22d3ee" stroke-width="1.5" opacity="0.12"/>
  <circle cx="540" cy="500" r="270" fill="none" stroke="#6366f1" stroke-width="1.5" opacity="0.22"/>
  <circle cx="540" cy="500" r="242" fill="none" stroke="#818cf8"
          stroke-dasharray="14 10" stroke-width="2.5" opacity="0.40"/>

  <!-- Photo Circle Dark Base -->
  <circle cx="540" cy="500" r="200" fill="url(#avatarGrad)"/>

  <!-- Initials Emblem (shown as placeholder inside circle) -->
  <text x="540" y="535"
        font-family="Arial, sans-serif"
        font-size="100" font-weight="bold" fill="#38bdf8" opacity="0.85"
        text-anchor="middle">${initials}</text>

  <!-- Glowing Accent Ring (Border) -->
  <circle cx="540" cy="500" r="210" fill="none" stroke="url(#accentGrad)"
          stroke-width="8" opacity="0.95" filter="url(#glow)"/>

  <!-- ── CELEBRANT NAME ── -->
  <text x="540" y="768"
        font-family="Arial, sans-serif"
        font-size="${nameFontSize}" font-weight="bold" fill="#ffffff"
        text-anchor="middle">${displayName}</text>

  ${preferredName ? `
  <!-- Nickname -->
  <text x="540" y="825"
        font-family="Arial, sans-serif"
        font-size="28" font-weight="bold" fill="#22d3ee"
        text-anchor="middle">${preferredName}</text>
  ` : ''}

  <!-- Decorative Line -->
  <line x1="260" y1="${preferredName ? 854 : 804}" x2="820" y2="${preferredName ? 854 : 804}"
        stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>

  <!-- ── BOTTOM BANNER ── -->
  <rect x="70" y="${preferredName ? 874 : 824}" width="940" height="152" rx="24"
        fill="rgba(8, 14, 30, 0.92)" stroke="rgba(255,255,255,0.14)" stroke-width="1.5"/>

  <text x="540" y="${preferredName ? 928 : 878}"
        font-family="Arial, sans-serif"
        font-size="22" font-weight="bold" fill="#f8fafc"
        text-anchor="middle">Wishing you a day filled with joy, peace &amp; outstanding code!</text>

  <text x="540" y="${preferredName ? 968 : 918}"
        font-family="Arial, sans-serif"
        font-size="15" fill="#64748b"
        text-anchor="middle">Official Birthday Celebration  ·  IT Department 25/26 Set</text>
</svg>`;

  // Render SVG to PNG with bundled TTF font
  const resvgOpts = {
    fitTo: { mode: 'width', value: 1080 }
  };
  if (fontBuffer) {
    resvgOpts.font = {
      fontBuffers: [fontBuffer],
      defaultFontFamily: 'Arial'
    };
  }

  const resvgInstance = new Resvg(svgDesign, resvgOpts);
  let pngBuffer = resvgInstance.render().asPng();

  // ─────────────────────────────────────────────────────────────────────────────
  // COMPOSITE CELEBRANT PHOTO (if photo file exists)
  // Photo Circle Center: cx=540, cy=500, r=200 -> Top-Left at (340, 300)
  // ─────────────────────────────────────────────────────────────────────────────
  if (resolvedPhotoPath) {
    try {
      const PHOTO_D = 400; // 200 * 2
      const CX = 340;      // 540 - 200
      const CY = 300;      // 500 - 200

      const bgImg = await Jimp.read(pngBuffer);
      const photo = await Jimp.read(resolvedPhotoPath);

      // Crop photo to square and resize to 400x400
      photo.cover(PHOTO_D, PHOTO_D);

      // Crop to circle
      const r = PHOTO_D / 2;
      photo.scan(0, 0, PHOTO_D, PHOTO_D, function (x, y, idx) {
        const dx = x - r;
        const dy = y - r;
        if (Math.sqrt(dx * dx + dy * dy) > r) {
          this.bitmap.data[idx + 3] = 0; // transparent
        }
      });

      // Composite onto background
      bgImg.composite(photo, CX, CY);
      pngBuffer = await bgImg.getBufferAsync(Jimp.MIME_PNG);
      console.log(`✅ Composited photo from ${resolvedPhotoPath} onto flyer.`);
    } catch (photoErr) {
      console.warn(`⚠️ Photo compositing skipped (${photoErr.message}). Using initials emblem.`);
    }
  }

  // Save PNG
  const flyerDir = path.join(__dirname, 'public', 'flyers');
  if (!fs.existsSync(flyerDir)) {
    fs.mkdirSync(flyerDir, { recursive: true });
  }

  const flyerFilename = `flyer-${Date.now()}-${Math.round(Math.random() * 9999)}.png`;
  const flyerPath = path.join(flyerDir, flyerFilename);
  fs.writeFileSync(flyerPath, pngBuffer);

  console.log(`✅ Birthday Flyer generated: ${flyerFilename} (${Math.round(pngBuffer.length / 1024)}KB)`);
  return flyerPath;
}

module.exports = { generateBirthdayFlyer };
