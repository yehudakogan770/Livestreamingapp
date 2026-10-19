const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage(); p.setDefaultTimeout(6000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:1420'); await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  for (const [key, name] of [['F3', 'monitor']]) {
    await p.keyboard.press(key); await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'Inputs', exact: true }).click(); await p.waitForTimeout(200); await p.getByRole('menuitem', { name: /Add input/ }).click(); await p.waitForTimeout(500);
    const nav = p.locator('.addinput__kinds');
    const sc = await nav.evaluate((n) => [n.scrollHeight, n.clientHeight, n.closest('.addinput__body').scrollHeight, n.closest('.addinput__body').clientHeight]);
    console.log(name, 'list/visible', sc);
    await p.screenshot({ path: `addg-${name}.png` });
    await p.keyboard.press('Escape'); await p.getByRole('button', { name: 'Cancel' }).click().catch(() => {}); await p.waitForTimeout(300);
  }
  console.log('errors', errs); await b.close();
})();
