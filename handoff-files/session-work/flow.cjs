const { chromium } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  pg.on('console', (m) => m.type() === 'error' && errs.push('CONSOLE ' + m.text()));
  await pg.goto('http://localhost:1421/?demo');
  await pg.waitForTimeout(1500);
  const clips = async () => pg.evaluate(() => [...document.querySelectorAll('.clip--video')].map((c) => c.querySelector('.clip__name')?.textContent + '@' + Math.round(parseFloat(c.style.left))));
  console.log('start', await clips());
  // Go to 1s, cut with Ctrl+K.
  for (let i = 0; i < 30; i++) await pg.keyboard.press('ArrowRight');
  await pg.keyboard.press('Control+k');
  console.log('after cut', await clips());
  // Switch camera at 3s with key 4.
  for (let i = 0; i < 60; i++) await pg.keyboard.press('ArrowRight');
  await pg.keyboard.press('4');
  console.log('after switch', await clips());
  // Select the clip at the playhead and add blur from the Effects tab.
  await pg.keyboard.press('d');
  await pg.click('.pp .tabs button:nth-child(2)');
  await pg.click('text=Gaussian blur');
  await pg.click('text=Basic correction >> nth=0');
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: S + '/flow1.png' });
  // Transition at the playhead (the cut at 3s).
  await pg.keyboard.press('Control+d');
  await pg.waitForTimeout(200);
  console.log('transitions', await pg.evaluate(() => [...document.querySelectorAll('.clip__tr')].map((t) => t.textContent)));
  // Undo three times, redo once.
  await pg.keyboard.press('Control+z');
  await pg.keyboard.press('Control+z');
  await pg.keyboard.press('Control+Shift+z');
  // Ripple delete the selected clip.
  await pg.keyboard.press('Escape');
  await pg.click('.clip--video >> nth=0');
  await pg.keyboard.press('Shift+Delete');
  console.log('after ripple delete', await clips());
  // Text.
  await pg.keyboard.press('Home');
  await pg.keyboard.press('Control+t');
  await pg.waitForTimeout(200);
  await pg.fill('.insp__words', 'Dana Levi\nHost');
  await pg.locator('.insp__words').blur();
  await pg.click('.tl__heads');
  for (let i = 0; i < 20; i++) await pg.keyboard.press('ArrowRight');
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: S + '/flow2.png' });
  // Export the first 3 seconds (browser: picture only).
  await pg.keyboard.press('Home');
  await pg.keyboard.press('i');
  for (let i = 0; i < 90; i++) await pg.keyboard.press('ArrowRight');
  await pg.keyboard.press('o');
  await pg.keyboard.press('Control+m');
  await pg.click('text=In to out');
  await pg.click('text=1280×720');
  const dl = pg.waitForEvent('download', { timeout: 120000 });
  await pg.click('.modal .btn--primary');
  const d = await dl;
  await d.saveAs(S + '/export.webm');
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: S + '/flow3.png' });
  console.log('errors:\n' + errs.join('\n'));
  await b.close();
})();
