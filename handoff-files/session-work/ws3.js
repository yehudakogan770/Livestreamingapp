const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const D = __dirname;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:5392/?demo');
  await p.waitForTimeout(8000);
  await p.getByRole('button', { name: /^Fit/ }).first().click().catch(e=>console.log('nofit'));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: D + '/ws3-edit.png' });
  await p.getByText('Color', { exact: true }).last().click().catch(e=>console.log('nocolor'));
  await p.waitForTimeout(3000);
  await p.screenshot({ path: D + '/ws3-color.png' });
  console.log(errs.slice(0, 5));
  await b.close();
})();
