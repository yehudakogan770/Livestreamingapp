const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 360 } })).newPage();
  const svg = fs.readFileSync('/home/user/Livestreamingapp/app/public/brand/lumora-logo.svg', 'utf8');
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await p.waitForTimeout(400);
  await p.locator('svg').screenshot({ path: '/home/user/Livestreamingapp/app/public/brand/lumora-logo.png', omitBackground: true });
  await b.close();
})();
