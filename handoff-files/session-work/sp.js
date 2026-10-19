const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  const add = async (kind, sw) => { await p.getByRole('button', { name: 'Add input' }).first().click(); await p.getByRole('button', { name: new RegExp('^' + kind) }).last().click(); if (sw) await p.getByRole('button', { name: sw }).click(); await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click(); await p.waitForTimeout(150); };
  await add('Test pattern'); await add('Colour', '#c7372f');
  await p.getByRole('button', { name: 'Add input' }).first().click();
  await p.getByRole('button', { name: /^Split screen/ }).click();
  await p.getByLabel('Box 1').selectOption({ label: 'Test pattern' });
  await p.getByLabel('Box 2').selectOption({ label: 'Colour' });
  await p.screenshot({ path: 'sp-add.png' });
  await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
  await p.locator('.tile__pick').nth(2).click(); await p.getByRole('button', { name: /^TAKE/ }).click();
  await p.waitForTimeout(1200);
  await p.locator('.mon--pgm').screenshot({ path: 'sp-side.png' });
  await p.getByRole('button', { name: 'REC' }).click(); await p.waitForTimeout(800);
  // Change to picture-in-picture while on air
  await p.locator('.tile').nth(2).locator('button:has-text("⋯")').first().click();
  await p.getByRole('button', { name: 'Edit split screen…' }).click();
  await p.getByRole('dialog', { name: 'Split screen' }).getByRole('button', { name: 'Picture-in-picture' }).click();
  await p.getByRole('button', { name: 'Done' }).click();
  await p.waitForTimeout(1500);
  await p.locator('.mon--pgm').screenshot({ path: 'sp-pip.png' });
  await p.locator('.bc-btn').first().click(); await p.getByRole('button', { name: 'Stop recording' }).click(); await p.waitForTimeout(900);
  const url = await p.locator('.bc-saved a').getAttribute('href');
  await p.evaluate(async (url) => {
    const v = document.createElement('video'); v.muted = true; v.src = url; v.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:540px;z-index:99999';
    document.body.appendChild(v); await new Promise((r) => (v.onloadeddata = r)); v.currentTime = 0.3; await new Promise((r) => (v.onseeked = r));
  }, url);
  await p.screenshot({ path: 'sp-rec.png' });
  console.log('errors', errs);
  await b.close();
})();
