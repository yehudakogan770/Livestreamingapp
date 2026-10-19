const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url, { width: 1440, height: 900 });
  await p.click('text=Two-line box');
  await p.waitForTimeout(500);
  const names = await p.$$eval('.tt-timeline .tt-name', (els) => els.map((e) => e.textContent));
  console.log(names.join(' | '));
  await p.click(`.tt-timeline .tt-name:text-is("${names[0]}")`);
  const insp = p.locator('[data-testid=titler-inspector]');
  // Effects: open section, add drop shadow
  for (const t of ['Effects', 'Masks', 'Animate', 'Layer styles']) {
    const sec = insp.locator('.tt-section-title', { hasText: t });
    if (await sec.count()) await sec.first().click();
  }
  await p.waitForTimeout(200);
  await insp.locator('.tt-section', { hasText: 'Effects are optional' }).scrollIntoViewIfNeeded();
  await shot('n1-sections');
  const effSel = insp.locator('select[aria-label="Add an effect"], select[aria-label*="effect" i]');
  console.log('effect selects', await effSel.count());
  const btns = await insp.locator('.tt-section', { hasText: 'Effects are optional' }).locator('button').allTextContents();
  console.log('effects buttons', btns.join(' | '));
  flush('sections');
  // Graph editor: select key on timeline
  await p.click('.tt-row.layer.sel .tt-ico >> nth=0');
  await p.waitForTimeout(200);
  const key = p.locator('.tt-row.prop .tt-key').first();
  await key.click();
  await p.click('.tt-tl-tabs button:has-text("Graph editor")');
  await p.waitForTimeout(300);
  await shot('n2-graph');
  // click "Ease" button
  const ease = p.locator('.tt-eases button', { hasText: 'Ease out' });
  if (await ease.count()) await ease.first().click();
  await p.waitForTimeout(200);
  await shot('n3-graph-ease');
  flush('graph');
  await p.click('.tt-tl-tabs button:has-text("Timeline")');
  // Formats: comp tab
  await p.click('.tt-right [data-tab=comp]');
  await p.waitForTimeout(200);
  const fm = p.locator('.tt-section-title', { hasText: 'Formats' });
  await fm.click();
  await p.waitForTimeout(200);
  await shot('n4-formats');
  const fbtns = await p.locator('.tt-section', { hasText: 'Formats' }).locator('button').allTextContents();
  console.log('format buttons', fbtns.join(' | '));
  flush('formats');
  // Render dialog: options
  await p.click('.tt-menu button:has-text("Render")');
  await p.waitForTimeout(200);
  console.log('render formats', await p.$$eval('.tt-modal select >> nth=0', () => ''));
  const opts = await p.$$eval('.tt-modal select', (sels) => sels.map((s) => [...s.options].map((o) => o.textContent + (o.disabled ? ' (x)' : '')).join(', ')));
  console.log(opts.join('\n'));
  await shot('n5-render');
  // render png sequence at half
  await p.selectOption('.tt-modal select >> nth=2', '0.5');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }).catch(() => null), p.click('.tt-modal button.tt-primary')]);
  console.log('render download', dl && (await dl.suggestedFilename()));
  await p.waitForTimeout(500);
  flush('render');
  // Note tool
  const box = await (await p.$('.tt-center canvas')).boundingBox();
  await p.keyboard.press('m');
  await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await p.waitForTimeout(200);
  await p.keyboard.type('Check the brand color here');
  await p.waitForTimeout(200);
  await shot('n6-note');
  await p.keyboard.press('Escape');
  flush('note');
  // keyboard time nav
  await p.keyboard.press('Home');
  await p.keyboard.press('l');
  await p.waitForTimeout(500);
  await p.keyboard.press('k');
  console.log('tc after L', await p.textContent('.tt-tc'));
  await p.keyboard.press('End');
  console.log('tc End', await p.textContent('.tt-tc'));
  flush('keys');
  await b.close();
})();
