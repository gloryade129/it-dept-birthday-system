const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const fontPath = 'C:\\Windows\\Fonts\\arialbd.ttf';
const fontBuffer = fs.readFileSync(fontPath);

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200">
  <rect width="500" height="200" fill="#0f172a"/>
  <text x="250" y="100" font-family="Arial" font-size="40" font-weight="bold" fill="#22d3ee" text-anchor="middle">HAPPY BIRTHDAY!</text>
</svg>
`;

const resvg = new Resvg(svg, {
  font: {
    fontBuffers: [fontBuffer],
    defaultFontFamily: 'Arial'
  }
});

const pngBuffer = resvg.render().asPng();
fs.writeFileSync(path.join(__dirname, 'test_output.png'), pngBuffer);
console.log('Successfully rendered PNG with bundled Arial font! Length:', pngBuffer.length);
