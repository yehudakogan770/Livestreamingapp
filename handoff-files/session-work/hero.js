const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///home/user/Livestreamingapp/docs/index.html'); await p.waitForTimeout(1500);
  await p.screenshot({ path: 'hero-a.png' });
  await p.evaluate(() => scrollTo(0, 420)); await p.waitForTimeout(2300);
  await p.screenshot({ path: 'hero-b.png' });
  await p.evaluate(() => scrollTo(0, 1100)); await p.waitForTimeout(2200);
  await p.screenshot({ path: 'hero-c.png' });
  console.log('errors', errs);
  await b.close();
})();
