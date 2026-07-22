const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

/**
 * 100% Pure JavaScript Birthday Flyer Generator using Jimp.
 * Zero native binary dependencies, zero blocked scripts, 100% compatible with Pxxl Cloud Linux containers.
 */
async function generateBirthdayFlyer({ fullName, nickname, birthDate, photoPath }) {
  const displayName = (fullName || 'ESTEEMED CELEBRANT').toUpperCase();
  const preferredName = nickname ? `"${nickname}"` : '';

  try {
    // 1. Create 1080x1080 dark luxury background image (#070b19)
    const image = new Jimp(1080, 1080, 0x070b19ff);

    // 2. Load Jimp built-in bitmap fonts (no OS font dependencies)
    const font64 = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    const font32 = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const font16 = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

    // 3. Draw Header Badge Text
    image.print(font32, 0, 80, {
      text: 'INFORMATION TECHNOLOGY 25/26 SET',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 1080);

    // 4. Draw Main Heading
    image.print(font64, 0, 150, {
      text: 'HAPPY BIRTHDAY!',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 1080);

    // 5. Composite Celebrant Photo if provided
    if (photoPath && fs.existsSync(photoPath)) {
      try {
        const photo = await Jimp.read(photoPath);
        photo.cover(400, 400);
        photo.circle();
        image.composite(photo, 340, 240);
        console.log('✅ Celebrant photo circular crop composited into Jimp flyer.');
      } catch (photoErr) {
        console.warn('⚠️ Could not composite photo onto flyer:', photoErr.message);
      }
    }

    // 6. Draw Celebrant Name
    image.print(font64, 0, 680, {
      text: displayName,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 1080);

    // 7. Draw Nickname
    if (preferredName) {
      image.print(font32, 0, 760, {
        text: preferredName,
        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
      }, 1080);
    }

    // 8. Draw Message Banner Text
    image.print(font32, 0, 850, {
      text: 'Wishing you success, peace & outstanding code!',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 1080);

    image.print(font16, 0, 920, {
      text: 'Official Birthday Celebration * IT Department 25/26 Set',
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER
    }, 1080);

    // 9. Save PNG file
    const flyerDir = path.join(__dirname, 'public', 'flyers');
    if (!fs.existsSync(flyerDir)) {
      fs.mkdirSync(flyerDir, { recursive: true });
    }

    const flyerFilename = `flyer-${Date.now()}-${Math.round(Math.random() * 9999)}.png`;
    const flyerPath = path.join(flyerDir, flyerFilename);
    await image.writeAsync(flyerPath);

    console.log(`✅ 100% Pure JS Birthday Flyer PNG generated: ${flyerFilename}`);
    return flyerPath;
  } catch (renderErr) {
    console.error('Jimp PNG flyer render error:', renderErr.message);
    return null;
  }
}

module.exports = {
  generateBirthdayFlyer
};
