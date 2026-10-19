const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  await p.click('text=Name and role');
  await p.waitForTimeout(500);
  const box = await (await p.$('.tt-center canvas')).boundingBox();
  await p.keyboard.press('t');
  await p.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.3);
  await p.waitForTimeout(300);
  await p.keyboard.type('Hello world, real text');
  await p.waitForTimeout(200);
  await shot('x1-typing');
  console.log('tool after typing', await p.getAttribute('.tt-tools button[aria-pressed=true]', 'aria-label'));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await shot('x2-done');
  console.log('layer names', await p.$$eval('.tt-timeline .tt-name', (els) => els.map((e) => e.textContent).join(' | ')));
  // undo should remove whole edit in one step
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(200);
  console.log('after undo', await p.$$eval('.tt-timeline .tt-name', (els) => els.map((e) => e.textContent).join(' | ')));
  await p.keyboard.press('Control+Shift+z');
  // double click Name text
  await p.mouse.dblclick(box.x + 540 - 236 + 0, box.y + 475 - 109);
  await p.waitForTimeout(300);
  await shot('x3-dbl');
  console.log('editing?', await p.$('.tt-text-edit') !== null);
  await p.keyboard.press('Escape');
  // Alt+R keyframe
  await p.click('.tt-timeline .tt-name:text-is("Role")');
  await p.keyboard.press('Alt+r');
  await p.waitForTimeout(200);
  console.log('status', await p.textContent('.tt-status'));
  console.log('tool', await p.getAttribute('.tt-tools button[aria-pressed=true]', 'aria-label'));
  for (const d of ['Export', 'Render']) {
    await p.click(`.tt-menu button:has-text("${d}")`);
    await p.waitForTimeout(200);
    await p.keyboard.press('Delete');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    console.log(d, 'closed on Escape:', (await p.$('.tt-modal')) === null);
  }
  console.log('layers still', await p.$$eval('.tt-timeline .tt-name', (els) => els.length));
  flush('end');
  await b.close();
})();
