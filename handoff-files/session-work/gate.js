const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420'); await p.waitForTimeout(2500);
  await p.screenshot({ path: 'gate-in.png' });
  await p.getByRole('button', { name: 'Make an account' }).click(); await p.waitForTimeout(300);
  await p.screenshot({ path: 'gate-new.png' });
  console.log('errors', errs);
  await b.close();
})();
