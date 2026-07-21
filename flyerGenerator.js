const path = require('path');
const fs = require('fs');

/**
 * Dynamic Birthday Flyer Generator
 * Generates an SVG/Canvas birthday flyer card with celebrant's photo, name, nickname, and IT 25/26 set graphics.
 */
async function generateBirthdayFlyer({ fullName, nickname, birthDate, photoPath }) {
  const displayName = fullName.toUpperCase();
  const preferredName = nickname ? `"${nickname}"` : '';
  const dateStr = birthDate || 'SPECIAL DAY';

  let photoDataUri = '';
  if (photoPath && fs.existsSync(photoPath)) {
    try {
      const buffer = fs.readFileSync(photoPath);
      const ext = path.extname(photoPath).toLowerCase().replace('.', '') || 'jpeg';
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      photoDataUri = `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (err) {
      console.error('Error reading photo for flyer:', err);
    }
  }

  // Generate SVG Flyer Graphic Buffer (1080x1080 High Resolution)
  const svgContent = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#050811" />
          <stop offset="50%" stop-color="#0b111f" />
          <stop offset="100%" stop-color="#111827" />
        </linearGradient>

        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="50%" stop-color="#6366f1" />
          <stop offset="100%" stop-color="#a855f7" />
        </linearGradient>

        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="15" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        <clipPath id="circleClip">
          <circle cx="540" cy="450" r="210" />
        </clipPath>
      </defs>

      <!-- Background -->
      <rect width="1080" height="1080" fill="url(#bgGrad)" />

      <!-- Decorative Background Glow Rings -->
      <circle cx="540" cy="450" r="320" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.25" />
      <circle cx="540" cy="450" r="260" fill="none" stroke="#818cf8" stroke-dasharray="12 12" stroke-width="3" opacity="0.35" />

      <!-- Header Badge -->
      <rect x="290" y="80" width="500" height="46" rx="23" fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1.5" />
      <text x="540" y="110" font-family="'Poppins', sans-serif" font-size="20" font-weight="700" fill="#38bdf8" text-anchor="middle" letter-spacing="3">INFORMATION TECHNOLOGY 25/26 SET</text>

      <!-- Main Heading -->
      <text x="540" y="185" font-family="'Poppins', sans-serif" font-size="44" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="-1">HAPPY BIRTHDAY!</text>

      <!-- Photo Frame Container -->
      <circle cx="540" cy="450" r="222" fill="none" stroke="url(#accentGrad)" stroke-width="8" filter="url(#glow)" />
      
      ${photoDataUri ? `
        <image href="${photoDataUri}" x="330" y="240" width="420" height="420" preserveAspectRatio="xMidYMid slice" clip-path="url(#circleClip)" />
      ` : `
        <circle cx="540" cy="450" r="210" fill="#1e293b" />
        <text x="540" y="470" font-family="'Poppins', sans-serif" font-size="90" fill="#38bdf8" text-anchor="middle">🎂</text>
      `}

      <!-- Celebrant Name & Nickname Box -->
      <text x="540" y="730" font-family="'Poppins', sans-serif" font-size="46" font-weight="800" fill="#ffffff" text-anchor="middle">${displayName}</text>
      ${preferredName ? `<text x="540" y="780" font-family="'Poppins', sans-serif" font-size="32" font-weight="600" fill="#38bdf8" text-anchor="middle">${preferredName}</text>` : ''}

      <!-- Message Banner -->
      <rect x="140" y="830" width="800" height="130" rx="20" fill="rgba(11, 17, 31, 0.85)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.5" />
      <text x="540" y="880" font-family="'Poppins', sans-serif" font-size="24" font-weight="600" fill="#f8fafc" text-anchor="middle">Wishing you a year filled with success, peace &amp; outstanding code!</text>
      <text x="540" y="920" font-family="'Poppins', sans-serif" font-size="18" font-weight="500" fill="#94a3b8" text-anchor="middle">Official Birthday Celebration • IT Department 25/26 Set</text>
    </svg>
  `;

  const flyerDir = path.join(__dirname, 'public', 'flyers');
  if (!fs.existsSync(flyerDir)) {
    fs.mkdirSync(flyerDir, { recursive: true });
  }

  const flyerFilename = `flyer-${Date.now()}-${Math.round(Math.random() * 1000)}.svg`;
  const flyerPath = path.join(flyerDir, flyerFilename);
  fs.writeFileSync(flyerPath, svgContent);

  return flyerPath;
}

module.exports = {
  generateBirthdayFlyer
};
