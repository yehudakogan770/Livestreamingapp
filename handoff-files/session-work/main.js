const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  for (const k of [/^Test pattern/, /^Colour/]) {
    await p.getByRole('button', { name: 'Add input' }).first().click();
    await p.getByRole('button', { name: k }).first().click();
    await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
  }
  await p.locator('.tile__pick').nth(0).dblclick();
  await p.screenshot({ path: 'main1.png' });
  await p.getByRole('button', { name: 'Make one and put it in Next' }).click();
  await p.getByRole('button', { name: 'Transition' }).click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'main2.png' });
  console.log('errors', errs);
  await b.close();
})();
