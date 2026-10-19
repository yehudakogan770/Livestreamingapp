const { chromium } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  pg.on('console', (m) => m.type() === 'error' && errs.push('CONSOLE ' + m.text()));
  await pg.goto('http://localhost:1421/?demo');
  await pg.waitForTimeout(1200);
  const clips = async (sel) => pg.evaluate((sel) => [...document.querySelectorAll(sel)].map((c) => (c.querySelector('.clip__name')?.textContent ?? '') + '@' + Math.round(parseFloat(c.style.left)) + '+' + Math.round(parseFloat(c.style.width))), sel);
  // Drag "Music bed" from the bin onto A3 at ~2s.
  await pg.click('text=Music & pictures');
  const tl = await pg.locator('.tl__scroll').boundingBox();
  const rows = await pg.evaluate(() => [...document.querySelectorAll('.tl__row')].map((r) => [r.className, parseFloat(r.style.top)]));
  console.log(rows);
  const last = rows[rows.length - 1];
  await pg.dragTo ? null : null;
  await pg.locator('.media__item:has-text("Music bed")').dragTo(pg.locator('.tl__scroll'), { targetPosition: { x: 120, y: last[1] + 10 } });
  await pg.waitForTimeout(300);
  console.log('audio clips', await clips('.clip--audio'));
  // Logo onto V2.
  await pg.locator('.media__item:has-text("Logo")').dragTo(pg.locator('.tl__scroll'), { targetPosition: { x: 60, y: rows[1][1] + 10 } });
  await pg.waitForTimeout(300);
  console.log('video clips', await clips('.clip--video'));
  // Trim the end of the first V1 clip with the mouse (roll into the next, Ctrl).
  const first = pg.locator('.clip--video:has-text("Wide")').first();
  const box = await first.boundingBox();
  await pg.mouse.move(box.x + box.width - 3, box.y + 10);
  await pg.mouse.down();
  await pg.mouse.move(box.x + box.width - 63, box.y + 10, { steps: 6 });
  await pg.mouse.up();
  console.log('after trim', await clips('.clip--video'));
  // Select the logo, keyframe its scale.
  await pg.click('.clip--video:has-text("Logo")');
  await pg.waitForTimeout(200);
  await pg.click('.prow:has-text("Scale") .prow__watch');
  for (let i = 0; i < 30; i++) await pg.keyboard.press('ArrowRight');
  const sc = pg.locator('.prow:has-text("Scale") .scrub');
  await sc.click();
  await pg.keyboard.press('Control+a');
  await pg.keyboard.type('40');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: S + '/flow4.png' });
  // Empty project.
  await pg.goto('http://localhost:1421/?empty');
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: S + '/flow5.png' });
  console.log('errors:\n' + errs.join('\n'));
  await b.close();
})();
