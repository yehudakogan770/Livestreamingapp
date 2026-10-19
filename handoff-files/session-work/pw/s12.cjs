const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url, { width: 1280, height: 720 });
  await shot('r0-small');
  await p.click('text=Breaking banner');
  await p.waitForTimeout(500);
  const names = await p.$$eval('.tt-timeline .tt-name', (els) => els.map((e) => e.textContent));
  console.log(names.join(' | '));
  await p.click(`.tt-timeline .tt-name:text-is("${names[names.length - 1]}")`);
  const insp = p.locator('[data-testid=titler-inspector]');
  const clickSec = async (t) => {
    const s = insp.locator('.tt-section-title', { hasText: t }).first();
    if ((await s.getAttribute('aria-expanded')) === 'false') await s.click();
  };
  await clickSec('Masks');
  await insp.getByRole('button', { name: /Rectangle mask/ }).click();
  await clickSec('Effects');
  await insp.getByRole('button', { name: /Drop shadow/ }).click();
  await p.waitForTimeout(300);
  await shot('r1-mask-shadow');
  flush('mask/effect');
  // color picker
  const sw = insp.locator('.tt-color-swatch').first();
  if (await sw.count()) {
    await sw.click();
    await p.waitForTimeout(200);
    await shot('r2-picker');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    console.log('picker closed on Escape:', (await p.$('.tt-cpk')) === null);
  }
  flush('picker');
  // drag a layer bar in time, undo = one step
  const bar = p.locator('.tt-row.layer.sel .tt-bar');
  const bb = await bar.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.mouse.down();
  await p.mouse.move(bb.x + bb.width / 2 - 100, bb.y + bb.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  console.log('status', await p.textContent('.tt-status'));
  const undoTitle = await p.getAttribute('button[aria-label=Undo]', 'title');
  console.log('undo title', undoTitle);
  // resize via canvas handle
  await p.keyboard.press('Control+0');
  // add 9:16 format
  await p.click('.tt-right [data-tab=comp]');
  const fm = p.locator('.tt-section-title', { hasText: 'Formats' });
  if ((await fm.getAttribute('aria-expanded')) === 'false') await fm.click();
  await p.waitForTimeout(200);
  const fsec = p.locator('.tt-section', { has: p.locator('.tt-section-title', { hasText: 'Formats' }) });
  console.log('formats section:', (await fsec.innerText()).slice(0, 400));
  const add = fsec.locator('button', { hasText: /9:16/ });
  if (await add.count()) {
    await add.first().click();
    await p.waitForTimeout(400);
    await shot('r3-format');
  }
  flush('formats');
  // close dirty tab via New + close
  await p.click('.tt-menu button:has-text("New")');
  await p.waitForTimeout(200);
  const close = p.locator('.tt-doc-tab-close').first();
  if (await close.count()) {
    await close.click();
    await p.waitForTimeout(200);
    await shot('r4-confirm');
    console.log('confirm dialog:', await p.$eval('.tt-modal', (e) => e.innerText).catch(() => 'none'));
    await p.keyboard.press('Escape');
  }
  flush('tabs');
  // export lottie
  await p.click('.tt-menu button:has-text("Export")');
  await p.click('text=Lottie (.json)');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }).catch(() => null), p.click('.tt-modal button.tt-primary')]);
  console.log('lottie', dl && (await dl.suggestedFilename()));
  await p.waitForTimeout(300);
  console.log('after export dialog:', await p.$eval('.tt-modal', (e) => e.innerText.slice(0, 300)).catch(() => 'none'));
  await shot('r5-export');
  flush('export');
  await b.close();
})();
