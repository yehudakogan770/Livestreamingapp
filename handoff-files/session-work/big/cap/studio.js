const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const D = __dirname;
(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
  });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  p.setDefaultTimeout(30000);
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));
  await p.goto('http://localhost:5393/?demo');
  await p.waitForTimeout(12000);
  await p.getByRole('button', { name: /^Fit/ }).first().click().catch(() => console.log('nofit'));
  await p.waitForTimeout(2500);
  const shot = async (name) => {
    for (let i = 0; i < 4; i++) {
      try {
        await p.screenshot({ path: D + '/out/' + name + '.png', timeout: 60000 });
        console.log('shot', name);
        return;
      } catch {
        await p.waitForTimeout(2000);
      }
    }
  };
  if (process.env.CLICK) {
    const [x, y] = process.env.CLICK.split(',').map(Number);
    await p.mouse.click(x, y);
    await p.waitForTimeout(2500);
  }
  await shot('s-edit');
  for (const name of ['Color', 'Audio']) {
    await p.locator('button', { hasText: new RegExp('^\\s*' + name + '\\s*$') }).last().click().catch(() => console.log('no ' + name));
    await p.waitForTimeout(5000);
    if (name === 'Color') {
      await p.mouse.click(235, 774);
      await p.waitForTimeout(2500);
    }
    await shot('s-' + name.toLowerCase());
  }
  console.log(errs.slice(0, 8));
  await b.close();
})();
