const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage(); p.setDefaultTimeout(5000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:1420'); await p.waitForTimeout(1200);
  await p.getByText('Skip for now').click().catch(() => {});
  const items = async (m) => { await p.getByRole('button', { name: m, exact: true }).first().click(); await p.waitForTimeout(300); const t = await p.getByRole('menuitem').allTextContents(); return t; };
  console.log('Inputs (off):', (await items('Inputs')).join(' | ')); await p.keyboard.press('Escape');
  const s = await items('Settings'); console.log('Settings:', s.join(' | '));
  await p.getByRole('menuitem', { name: /Jewish event tools/ }).click(); await p.waitForTimeout(300);
  console.log('Inputs (on):', (await items('Inputs')).join(' | ')); await p.keyboard.press('Escape');
  await p.screenshot({ path: 'jt.png' });
  console.log('errors', errs); await b.close();
})();
