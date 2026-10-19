const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url, { width: 1366, height: 768 });
  await shot('m0-small');
  await p.click('text=Scoreboard bug');
  await p.waitForTimeout(600);
  await shot('m1-score');
  flush('open');
  await p.click('.tt-viewbar .tt-menubtn');
  await p.waitForTimeout(200);
  await shot('m2-view');
  await p.keyboard.press('Escape');
  // select a shape layer via timeline
  const names = await p.$$eval('.tt-timeline .tt-name', (els) => els.map((e) => e.textContent));
  console.log('layers', names.join(' | '));
  const shapeName = names.find((n) => /box|bar|panel|back/i.test(n)) || names[names.length - 1];
  await p.click(`.tt-timeline .tt-name:text-is("${shapeName}")`);
  await p.waitForTimeout(200);
  await shot('m3-shape');
  // scroll inspector
  await p.evaluate(() => document.querySelector('.tt-right .tt-dock-body').scrollTo(0, 600));
  await p.waitForTimeout(200);
  await shot('m4-shape2');
  await p.evaluate(() => document.querySelector('.tt-right .tt-dock-body').scrollTo(0, 1400));
  await p.waitForTimeout(200);
  await shot('m5-shape3');
  await p.evaluate(() => document.querySelector('.tt-right .tt-dock-body').scrollTo(0, 2400));
  await p.waitForTimeout(200);
  await shot('m6-shape4');
  flush('inspector');
  // Composition panel
  await p.click('.tt-right [data-tab=comp]');
  await p.waitForTimeout(200);
  for (const t of ['Cue markers', 'Formats']) {
    const btn = p.locator('.tt-section-title', { hasText: t });
    if (await btn.count()) await btn.first().click();
  }
  await p.waitForTimeout(200);
  await shot('m7-comp');
  flush('comp');
  // copy paste group
  await p.click(`.tt-timeline .tt-name:text-is("${names[0]}")`);
  await p.keyboard.press('Control+c');
  await p.keyboard.press('Control+v');
  await p.waitForTimeout(300);
  console.log('after paste', await p.$$eval('.tt-timeline .tt-name', (els) => els.length));
  await p.keyboard.down('Shift');
  await p.click(`.tt-timeline .tt-name:text-is("${names[1]}")`);
  await p.keyboard.up('Shift');
  await p.keyboard.press('Control+g');
  await p.waitForTimeout(300);
  await shot('m8-group');
  flush('group');
  // canvas only
  await p.keyboard.press('`');
  await p.waitForTimeout(200);
  await shot('m9-canvasonly');
  await p.keyboard.press('`');
  // pen tool
  const box = await (await p.$('.tt-center canvas')).boundingBox();
  await p.keyboard.press('g');
  for (const [x, y] of [[0.3, 0.3], [0.5, 0.25], [0.6, 0.45]]) await p.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  await shot('m10-pen');
  flush('pen');
  // History panel
  await p.click('.tt-left [data-tab=history]');
  await p.waitForTimeout(200);
  await shot('m11-history');
  flush('history');
  // project panel
  await p.click('.tt-left [data-tab=project]');
  await p.waitForTimeout(200);
  await shot('m12-project');
  flush('project');
  await b.close();
})();
