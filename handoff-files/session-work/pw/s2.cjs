const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  flush('load');
  // Open a template
  await p.click('text=Name and role');
  await p.waitForTimeout(800);
  await shot('t1-template');
  flush('template');
  // Select on canvas
  const canvas = await p.$('.tt-center canvas');
  const box = await canvas.boundingBox();
  console.log('canvas box', box);
  await p.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.78);
  await p.waitForTimeout(400);
  await shot('t2-select');
  flush('select');
  for (const tab of ['Composition', 'Fields', 'Look', 'Data', 'Layer']) {
    await p.click(`.tt-right .tt-tabs button:has-text("${tab}")`);
    await p.waitForTimeout(300);
    await shot('t3-' + tab);
    flush('tab ' + tab);
  }
  // Text tool
  await p.keyboard.press('Escape');
  await p.keyboard.press('t');
  await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await p.waitForTimeout(300);
  await p.keyboard.type('Hello world');
  await p.waitForTimeout(300);
  await shot('t4-text');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await shot('t4b-text-done');
  flush('text');
  // Rect tool
  await p.keyboard.press('r');
  await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.65, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  await shot('t5-rect');
  flush('rect');
  await p.keyboard.press('e');
  await p.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.35, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  await shot('t6-ellipse');
  flush('ellipse');
  // undo/redo
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(200);
  await shot('t7-undo');
  await p.keyboard.press('Control+Shift+z');
  await p.waitForTimeout(200);
  flush('undo');
  // play
  await p.keyboard.press(' ');
  await p.waitForTimeout(1200);
  await p.keyboard.press(' ');
  await shot('t8-play');
  flush('play');
  await p.click('text=Graph editor');
  await p.waitForTimeout(300);
  await shot('t9-graph');
  flush('graph');
  await p.click('.tt-timeline-wrap >> text=Timeline');
  for (const w of ['animate', 'data', 'operator', 'design']) {
    await p.selectOption('select[aria-label=Workspace]', w);
    await p.waitForTimeout(400);
    await shot('w-' + w);
    flush('ws ' + w);
  }
  for (const d of ['Export', 'Render']) {
    await p.click(`.tt-menu button:has-text("${d}")`);
    await p.waitForTimeout(300);
    await shot('d-' + d);
    flush('dlg ' + d);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    const still = await p.$('.tt-modal');
    if (still) { console.log(d + ' dialog did not close on Escape'); await p.click('.tt-modal button:has-text("Cancel"), .tt-modal button:has-text("Close")'); }
  }
  await p.keyboard.press('?');
  await p.waitForTimeout(300);
  await shot('d-keys');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  if (await p.$('.tt-modal')) console.log('shortcuts did not close on Escape');
  await p.keyboard.press('Control+s');
  await p.waitForTimeout(600);
  console.log('status', await p.textContent('.tt-status'));
  await p.click('.tt-left .tt-tabs button:has-text("History")');
  await p.waitForTimeout(300);
  await shot('h-history');
  flush('end');
  await b.close();
})();
