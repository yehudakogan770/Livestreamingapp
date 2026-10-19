const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); localStorage.setItem('lumora.jewishTools', 'on'); } catch {} });
  await p.goto('http://localhost:1420'); await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  await p.getByRole('button', { name: 'Inputs', exact: true }).click(); await p.waitForTimeout(200);
  await p.getByRole('menuitem', { name: /12 Pesukim bar/ }).click(); await p.waitForTimeout(1200);
  // on air, then pick pasuk 2 (long), then Whole
  await p.getByRole('button', { name: /Bar on|Show/ }).first().click().catch(() => {});
  await p.waitForTimeout(800);
  for (const n of [1, 5, 9]) {
    await p.locator('.pk select').first().selectOption({ index: n }).catch((e) => console.log('sel', e.message.split('\n')[0]));
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: /^Whole/ }).click(); await p.waitForTimeout(1500);
    await p.screenshot({ path: `whole-${n}.png` });
    await p.getByRole('button', { name: /^Whole/ }).click(); await p.waitForTimeout(500);
  }
  console.log('errors', errs);
  await b.close();
})();
