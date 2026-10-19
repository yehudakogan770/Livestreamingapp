const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const D = __dirname + '/..';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await p.goto('file://' + D + '/tonight.html');
  await p.waitForTimeout(500);
  await p.screenshot({ path: D + '/tonight.png' });
  await b.close();
})();
