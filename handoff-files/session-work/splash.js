const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 860, height: 516 } })).newPage();
  await p.goto('http://localhost:1420/splash.html');
  for (const [ms, n] of [[350, 1], [900, 2], [2900, 3]]) { await p.waitForTimeout(ms - (n === 1 ? 0 : n === 2 ? 350 : 900)); await p.screenshot({ path: `splash${n}.png` }); }
  await b.close();
})();
