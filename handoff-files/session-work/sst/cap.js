const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const D = __dirname;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5393/?demo');
  await p.waitForTimeout(9000);
  await p.getByRole('button', { name: /^Fit/ }).first().click().catch(() => console.log('nofit'));
  await p.waitForTimeout(1500);
  // move playhead to a moment with a title slide: click in the ruler
  await p.screenshot({ path: D + '/s-edit.png' });
  for (const name of ['Color', 'Audio']) {
    await p.locator('button', { hasText: new RegExp('^\s*' + name + '\s*$') }).last().click().catch(() => console.log('no ' + name));
    await p.waitForTimeout(3500);
    await p.screenshot({ path: D + '/s-' + name.toLowerCase() + '.png' });
  }
  console.log(errs.slice(0, 5));
  await b.close();
})();
