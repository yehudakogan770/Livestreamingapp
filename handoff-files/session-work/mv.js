const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(20000);
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  // Menus open
  await p.locator('.titlebar__item', { hasText: /^Inputs$/ }).click();
  console.log('menu open:', await p.locator('.titlebar__drop').isVisible());
  const top = await p.evaluate(() => { const d = document.querySelector('.titlebar__drop'); const r = d.getBoundingClientRect(); const el = document.elementFromPoint(r.left + 20, r.top + 15); return d.contains(el) ? true : (el.tagName + '.' + el.className + ' < ' + el.parentElement?.className + ' < ' + el.parentElement?.parentElement?.className); });
  console.log('menu is on top:', top);
  await p.keyboard.press('Escape');
  for (const kind of ['Colour', 'Test pattern', 'Countdown']) {
    await p.getByRole('button', { name: 'Add input' }).first().click();
    await p.getByRole('button', { name: new RegExp('^' + kind) }).first().click();
    await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
    await p.waitForTimeout(150);
  }
  await p.locator('.tile__pick').nth(1).dblclick();
  await p.getByRole('button', { name: /^Outputs/ }).click();
  await p.getByLabel('Multiview layout').selectOption('bothScreens');
  await p.screenshot({ path: 'mv-outputs.png' });
  // The multiview itself (its own page, same show would come from the engine in the app)
  const q = await b.newPage({ viewport: { width: 1280, height: 720 } });
  q.on('pageerror', (e) => errs.push('mv: ' + e.message));
  await q.goto('http://localhost:1420/?output=multiview');
  await q.waitForTimeout(800);
  console.log('multiview boxes:', await q.locator('.mv__box').count());
  await q.screenshot({ path: 'mv.png' });
  console.log('errors', errs);
  await b.close();
})();
