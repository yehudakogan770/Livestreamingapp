const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5391/');
  await p.waitForTimeout(4000);
  await p.screenshot({ path: __dirname + '/ws1.png' });
  console.log(errs.slice(0, 5));
  console.log((await p.locator('body').innerText()).slice(0, 1500));
  await b.close();
})();
