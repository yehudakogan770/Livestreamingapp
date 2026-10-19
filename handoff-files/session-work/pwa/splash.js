// iOS launch images for the Planner: the boot screen (mark + name) per iPhone size, light and dark.
// usage: node splash.js <planner/public dir>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const GF = path.join(__dirname, '..', 'gfonts') + '/';
// [css width, css height, dpr]
const SIZES = [
  [440, 956, 3], // 16 Pro Max
  [402, 874, 3], // 16 Pro
  [430, 932, 3], // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 13, 14
  [375, 812, 3], // X, XS, 11 Pro, 12/13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // SE, 8
];
const mark = fs.readFileSync(path.join(out, 'mark.svg'), 'utf8');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  fs.mkdirSync(path.join(out, 'splash'), { recursive: true });
  const links = [];
  for (const [w, h, dpr] of SIZES) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(GF + 'fonts.css', 'utf8') }));
      await page.route('https://fonts.gstatic.com/**', (r) => {
        const f = r.request().url().replace('https://fonts.gstatic.com/', '').replace(/\//g, '_');
        return r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(GF + f), headers: { 'access-control-allow-origin': '*' } });
      });
      const bg = scheme === 'light' ? '#f5f5f4' : '#141413';
      const fg = scheme === 'light' ? '#1a1a19' : '#ececea';
      await page.setContent(`<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@600&display=block">
<style>html,body{margin:0;height:100%}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:${bg};color:${fg};font:600 15px 'IBM Plex Sans',sans-serif}svg{width:40px;height:40px}</style>
</head><body>${mark}<span>Lumora Planner</span></body></html>`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const name = `splash/${w * dpr}x${h * dpr}-${scheme}.png`;
      await page.screenshot({ path: path.join(out, name) });
      await ctx.close();
      links.push(
        `    <link rel="apple-touch-startup-image" href="./${name}" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})" />`,
      );
    }
  }
  await browser.close();
  console.log(links.join('\n'));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
