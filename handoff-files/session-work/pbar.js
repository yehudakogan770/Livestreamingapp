const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1020 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  // A "camera" (test pattern) on air.
  await p.getByRole('button', { name: /Add input/ }).first().click();
  await p.getByRole('dialog', { name: 'Add input' }).getByRole('button', { name: /^Test pattern/ }).click();
  await p.getByRole('dialog', { name: 'Add input' }).getByRole('button', { name: 'Add input' }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'CUT', exact: true }).click();
  await p.getByRole('button', { name: '12 Pesukim', exact: true }).click();
  await p.getByText('Add the 12 Pesukim bar (ready in Next)').click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'pbar-1.png' });
  await p.getByRole('button', { name: 'Show the bar on the screen' }).click();
  await p.waitForTimeout(900);
  await p.keyboard.press('Space');
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'pbar-2.png' });
  console.log('errors', errs);
  await b.close();
})();
