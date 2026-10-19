const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1670, height: 887 } });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:1420' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  for (let i = 0; i < 2; i++) {
    await p.getByRole('button', { name: /Add input/ }).first().click();
    const d = p.getByRole('dialog', { name: 'Add input' });
    await d.getByRole('button', { name: /^Camera/ }).first().click();
    await p.waitForTimeout(800);
    if (i === 0) await p.screenshot({ path: 'cams-add.png' });
    const sel = d.locator('select').first(); const opts = await sel.locator('option').allTextContents(); console.log('options', opts);
    await d.getByRole('button', { name: 'fake_device_0' }).click();
    await d.getByRole('button', { name: 'Add input' }).click();
    await p.waitForTimeout(500);
  }
  console.log('buttons', await p.locator('.cambar__btn').allTextContents());
  await p.locator('.cambar__btn').nth(0).click();
  await p.waitForTimeout(300);
  console.log('on air', await p.locator('.mon--pgm .mon__head em').textContent());
  // Auto: every 2 seconds.
  await p.locator('.cambar__gear').click();
  await p.getByRole('checkbox').nth(0).check();
  await p.getByRole('checkbox').nth(1).check();
  await p.getByLabel('Shortest shot, seconds').fill('2');
  await p.getByLabel('Longest shot, seconds').fill('2');
  await p.screenshot({ path: 'cams-switch.png' });
  await p.getByRole('button', { name: 'Start switching by itself' }).click();
  await p.getByRole('tab', { name: /^1 ·/ }).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'cams-cam.png' });
  await p.keyboard.press('Escape');
  const seen = [];
  for (let i = 0; i < 6; i++) { seen.push(await p.locator('.cambar__btn').evaluateAll((els) => els.findIndex((e) => e.classList.contains('is-on')))); await p.waitForTimeout(1000); }
  console.log('on air over 6 s', seen);
  await p.screenshot({ path: 'cams-main.png' });
  console.log('errors', errs);
  await b.close();
})();
