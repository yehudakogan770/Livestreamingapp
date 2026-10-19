// Renders the planner's small icons from its SVGs: favicon-32.png (the colour mark) and icon-maskable-192.png.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const pub = process.argv[2];
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const shoot = async (svg, size, out, bg) => {
    await page.setViewportSize({ width: size, height: size });
    const data = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    await page.setContent(`<html><body style="margin:0;background:${bg || 'transparent'}"><img src="${data}" style="display:block;width:${size}px;height:${size}px"></body></html>`);
    await page.waitForTimeout(100);
    await page.screenshot({ path: out, omitBackground: !bg, clip: { x: 0, y: 0, width: size, height: size } });
  };
  const mark = fs.readFileSync(pub + '/mark.svg', 'utf8');
  await shoot(mark, 32, pub + '/favicon-32.png');
  // Maskable: the mark inside the safe zone (80%) on the full-bleed dark square.
  const icon = fs.readFileSync(pub + '/icon.svg', 'utf8').replace('rx="10"', 'rx="0"').replace('scale(0.72)', 'scale(0.6)');
  await shoot(icon, 192, pub + '/icon-maskable-192.png');
  await browser.close();
})();
