const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  await p.getByRole('button', { name: 'Help', exact: true }).click();
  await p.getByText('How to use Lumora').click();
  await p.waitForTimeout(400);
  await p.getByLabel('Search the manual').fill('zoom');
  await p.waitForTimeout(300);
  console.log('found', await p.locator('.hlp__topic').allTextContents());
  await p.screenshot({ path: 'help.png' });
  console.log('errors', errs);
  await b.close();
})();
