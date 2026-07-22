const path = require('path');
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');

/**
 * Dynamic Birthday Flyer Generator
 * Generates an ultra-high resolution 1080x1080 PNG birthday flyer card.
 * Uses @resvg/resvg-js with loadSystemFonts + imageHrefs for full Linux compatibility.
 */
async function generateBirthdayFlyer({ fullName, nickname, birthDate, photoPath }) {
  const displayName = (fullName || 'ESTEEMED CELEBRANT').toUpperCase();
  const preferredName = nickname ? `"${nickname}"` : '';

  // Read photo buffer for imageHrefs (works on Pxxl Linux without data URI issues)
  let photoBuffer = null;
  const PHOTO_HREF = 'student-photo';

  if (photoPath && fs.existsSync(photoPath)) {
    try {
      photoBuffer = fs.readFileSync(photoPath);
    } catch (err) {
      console.warn('Could not read photo for flyer:', err.message);
    }
  }

  // SVG uses a simple href="student-photo" which resvg resolves via imageHrefs
  const photoElement = photoBuffer
    ? `<image href="${PHOTO_HREF}" x="330" y="240" width="420" height="420" preserveAspectRatio="xMidYMid slice" clip-path="url(#circleClip)" />`
    : `<circle cx="540" cy="450" r="210" fill="#1e293b" /><text x="540" y="490" font-family="Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif" font-size="90" fill="#38bdf8" text-anchor="middle">&#x1F382;</text>`;

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#050811" />
      <stop offset="50%" stop-color="#0b111f" />
      <stop offset="100%" stop-color="#111827" />
    </linearGradient>

    <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="50%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#a855f7" />
    </linearGradient>

    <clipPath id="circleClip">
      <circle cx="540" cy="450" r="210" />
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="1080" height="1080" fill="url(#bgGrad)" />

  <!-- Decorative Glow Rings -->
  <circle cx="540" cy="450" r="320" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.25" />
  <circle cx="540" cy="450" r="260" fill="none" stroke="#818cf8" stroke-dasharray="12 12" stroke-width="3" opacity="0.35" />

  <!-- Header Badge Background -->
  <rect x="190" y="72" width="700" height="52" rx="26" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.22)" stroke-width="1.5" />

  <!-- Header Badge Text -->
  <text x="540" y="106" font-family="Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif" font-size="19" font-weight="bold" fill="#38bdf8" text-anchor="middle" letter-spacing="2">INFORMATION TECHNOLOGY 25/26 SET</text>

  <!-- Main Heading -->
  <text x="540" y="182" font-family="Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif" font-size="52" font-weight="bold" fill="#ffffff" text-anchor="middle">HAPPY BIRTHDAY!</text>

  <!-- Photo Frame Ring -->
  <circle cx="540" cy="450" r="222" fill="none" stroke="url(#accentGrad)" stroke-width="8" />

  <!-- Photo or emoji placeholder -->
  ${photoElement}

  <!-- Celebrant Name -->
  <text x="540" y="730" font-family="Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif" font-size="48" font-weight="bold" fill="#ffffff" text-anchor="middle">${displayName}</text>

  ${preferredName ? `<text x="540" y="782" font-family="Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif" font-size="32" font-weight="bold" fill="#38bdf8" text-anchor="middle">${preferredName}</text>` : ''}

  <!-- Message Banner Background -->
  <rect x="100" y="830" width="880" height="140" rx="22" fill="rgba(11,17,31,0.88)" stroke="rgba(255,255,255,0.13)" stroke-width="1.5" />

  <!-- Message Banner Text Line 1 -->
  <text x="540" y="880" font-family="Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif" font-size="22" font-weight="bold" fill="#f8fafc" text-anchor="middle">Wishing you a year filled with success, peace and outstanding code!</text>

  <!-- Message Banner Text Line 2 -->
  <text x="540" y="924" font-family="Liberation Sans, DejaVu Sans, Arial, Helvetica, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">Official Birthday Celebration  *  IT Department 25/26 Set</text>
</svg>`;

  try {
    const resvgOptions = {
      fitTo: { mode: 'width', value: 1080 },
      font: {
        loadSystemFonts: true,
        defaultFontFamily: 'Liberation Sans'
      }
    };

    // Pass photo via imageHrefs — avoids data URI embedding issues on Linux
    if (photoBuffer) {
      resvgOptions.imageHrefs = {
        [PHOTO_HREF]: photoBuffer
      };
    }

    const resvg = new Resvg(svgContent, resvgOptions);
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    const flyerDir = path.join(__dirname, 'public', 'flyers');
    if (!fs.existsSync(flyerDir)) {
      fs.mkdirSync(flyerDir, { recursive: true });
    }

    const flyerFilename = `flyer-${Date.now()}-${Math.round(Math.random() * 9999)}.png`;
    const flyerPath = path.join(flyerDir, flyerFilename);
    fs.writeFileSync(flyerPath, pngBuffer);

    console.log(`✅ Birthday Flyer PNG generated: ${flyerFilename} (${Math.round(pngBuffer.length / 1024)}KB)`);
    return flyerPath;
  } catch (renderErr) {
    console.error('Resvg PNG flyer render error:', renderErr.message);
    return null;
  }
}

module.exports = {
  generateBirthdayFlyer
};
