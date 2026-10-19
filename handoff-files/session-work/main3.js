const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
  p.setDefaultTimeout(15000);
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  for (const k of [/^Test pattern/, /^Colour/, /^Hebrew date/]) {
    await p.getByRole('button', { name: 'Add input' }).first().click();
    await p.getByRole('button', { name: k }).first().click();
    await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
  }
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'main3.png' });
  await b.close();
})();
