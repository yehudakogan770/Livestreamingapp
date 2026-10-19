const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  await p.click('text=Two-line box');
  await p.waitForTimeout(500);
  // formats: add 9:16
  await p.click('.tt-right [data-tab=comp]');
  const fm = p.locator('.tt-section-title', { hasText: 'Formats' });
  if ((await fm.getAttribute('aria-expanded')) === 'false') await fm.click();
  const fsec = p.locator('.tt-section', { has: p.locator('.tt-section-title', { hasText: 'Formats' }) });
  const sel = fsec.locator('select').first();
  const opts = await sel.evaluate((s) => [...s.options].map((o) => o.value + '=' + o.textContent));
  console.log(opts.join(' | '));
  await sel.selectOption({ index: 1 });

  await p.waitForTimeout(400);
  await shot('w1-format');
  console.log('comps:', await p.$$eval('.tt-left .tt-side-item', (els) => els.map((e) => e.textContent).join(' | ')).catch(() => ''));
  flush('format');
  // project panel: switch to the new format composition
  await p.click('.tt-left [data-tab=project]');
  await p.waitForTimeout(200);
  const items = p.locator('.tt-left .tt-side-item');
  console.log('project items', await items.allTextContents());
  if ((await items.count()) > 1) {
    await items.nth(1).dblclick();
    await p.waitForTimeout(400);
    await shot('w2-vertical');
  }
  flush('switch');
  // versions: keep one
  await p.click('.tt-left [data-tab=history]');
  const name = p.getByPlaceholder('Name this version');
  await name.fill('Before changes');
  await p.getByRole('button', { name: 'Keep' }).click();
  await p.waitForTimeout(500);
  await shot('w3-versions');
  // history: click first step
  const steps = p.locator('.tt-steps button');
  console.log('steps', await steps.allTextContents());
  if ((await steps.count()) > 1) await steps.first().click();
  await p.waitForTimeout(300);
  await shot('w4-history-back');
  flush('history');
  // canvas wheel zoom
  const cv = await (await p.$('.tt-center canvas')).boundingBox();
  await p.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
  await p.keyboard.down('Control');
  await p.mouse.wheel(0, -300);
  await p.keyboard.up('Control');
  await p.waitForTimeout(300);
  console.log('zoom', await p.$eval('select[aria-label=Zoom]', (s) => s.value));
  await shot('w5-zoom');
  flush('zoom');
  await b.close();
})();
