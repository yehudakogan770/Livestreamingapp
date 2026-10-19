const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  await p.click('text=Name and role');
  await p.waitForTimeout(500);
  await shot('g1-main');
  // drag "Fields" tab from right to the left dock tabs
  const src = await (await p.$('.tt-right [data-tab=fields]')).boundingBox();
  const dst = await (await p.$('.tt-left .tt-tabs')).boundingBox();
  await p.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await p.mouse.down();
  await p.mouse.move(src.x - 40, src.y + 20, { steps: 5 });
  await p.mouse.move(dst.x + dst.width - 10, dst.y + dst.height / 2, { steps: 10 });
  await shot('g2-dragging');
  await p.mouse.up();
  await p.waitForTimeout(300);
  await shot('g3-dropped');
  // drag Look to bottom of right group -> split
  const look = await (await p.$('.tt-right [data-tab=look]')).boundingBox();
  const body = await (await p.$('.tt-right .tt-dock-body')).boundingBox();
  await p.mouse.move(look.x + 10, look.y + 8);
  await p.mouse.down();
  await p.mouse.move(look.x, look.y + 60, { steps: 5 });
  await p.mouse.move(body.x + body.width / 2, body.y + body.height - 20, { steps: 10 });
  await shot('g4-split');
  await p.mouse.up();
  await p.waitForTimeout(300);
  await shot('g5-split-done');
  console.log(await p.evaluate(() => localStorage.getItem('lumora-titler-layout')));
  // view menu
  await p.click('button:has-text("View")');
  await p.waitForTimeout(200);
  await shot('g6-view');
  await p.keyboard.press('Escape');
  await p.click('.tt-workspace .tt-menubtn');
  await p.waitForTimeout(200);
  await shot('g7-ws');
  await p.click('text=Reset Design');
  await p.waitForTimeout(300);
  await shot('g8-reset');
  flush('end');
  await b.close();
})();
