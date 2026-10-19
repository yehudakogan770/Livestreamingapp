const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
  await p.goto('http://localhost:1420'); await p.waitForTimeout(4000);
  await p.screenshot({ path: 'peek.png' });
  console.log(errs.slice(0, 5));
  await b.close();
})();
