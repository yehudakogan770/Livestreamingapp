const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const D = __dirname;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--allow-file-access-from-files'] });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
  await p.goto('file://' + D + '/og.html');
  await p.waitForTimeout(800);
  await p.screenshot({ path: D + '/out/og.png' });
  await b.close();
})();
