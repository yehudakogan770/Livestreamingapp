const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  await p.click('text=Full-screen title');
  await p.waitForTimeout(500);
  await p.click('.tt-timeline .tt-name:text-is("Background")');
  const insp = p.locator('[data-testid=titler-inspector]');
  const sec = insp.locator('.tt-section-title', { hasText: 'Masks' }).first();
  if ((await sec.getAttribute('aria-expanded')) === 'false') await sec.click();
  await insp.getByRole('button', { name: /Ellipse mask/ }).click();
  await p.waitForTimeout(300);
  await shot('u1-mask');
  // drag the mask's top point
  const boxes = await p.evaluate(() => null);
  void boxes;
  // find mask points: canvas scale; Background is full frame; ellipse 60% centered: top point at (960, 108)
  const cv = await (await p.$('.tt-center canvas')).boundingBox();
  const frame = { x: 371, y: 120, w: 794, h: 446 }; // from earlier screenshots at 1600x950
  const P = (x, y) => [frame.x + (x / 1920) * frame.w, frame.y + (y / 1080) * frame.h];
  const [tx, ty] = P(960, 216);
  await p.mouse.move(tx, ty);
  await p.mouse.down();
  await p.mouse.move(tx + 10, ty - 60, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  console.log('status/undo:', await p.getAttribute('button[aria-label=Undo]', 'title'));
  await shot('u2-dragged');
  // animate the mask, move playhead, change box width
  await insp.getByRole('button', { name: 'Animate the mask' }).click();
  await p.keyboard.press('End');
  const w = insp.getByLabel('Shape width');
  await w.click();
  await w.fill('300');
  await w.press('Enter');
  await p.waitForTimeout(200);
  // open layer props in timeline to see outline row
  await p.click('.tt-row.layer.sel .tt-ico >> nth=0');
  await p.waitForTimeout(200);
  await shot('u3-animated');
  console.log('outline rows', await p.locator('.tt-row.prop', { hasText: 'shape' }).count());
  flush('mask');
  // pen path editing: draw a path, double-click to edit points
  await p.keyboard.press('Escape');
  await p.keyboard.press('g');
  for (const [x, y] of [[300, 300], [700, 250], [800, 600], [350, 650]]) {
    const q = P(x, y);
    await p.mouse.click(q[0], q[1]);
  }
  const q0 = P(300, 300);
  await p.mouse.click(q0[0], q0[1]); // close
  await p.waitForTimeout(300);
  await p.keyboard.press('v');
  const mid = P(700, 250);
  await p.mouse.dblclick(mid[0] - 30, mid[1] + 30);
  await p.waitForTimeout(300);
  await shot('u4-editpoints');
  // alt-drag a point to round it
  await p.keyboard.down('Alt');
  await p.mouse.move(mid[0], mid[1]);
  await p.mouse.down();
  await p.mouse.move(mid[0] + 60, mid[1] + 10, { steps: 6 });
  await p.mouse.up();
  await p.keyboard.up('Alt');
  await p.waitForTimeout(200);
  await shot('u5-rounded');
  console.log('undo:', await p.getAttribute('button[aria-label=Undo]', 'title'));
  flush('path');
  await b.close();
})();
