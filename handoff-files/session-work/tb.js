const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  console.log(await p.locator('.titlebar__item').allTextContents(), errs);
  await p.screenshot({ path: 'tb.png' });
  await b.close();
})();
