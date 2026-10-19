const { chromium } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  pg.on('console', (m) => m.type() === 'error' && errs.push('CONSOLE ' + m.text()));
  await pg.goto('http://localhost:1421/?demo');
  await pg.waitForTimeout(1200);
  const clips = async () => pg.evaluate(() => [...document.querySelectorAll('.clip')].map((c) => (c.querySelector('.clip__name')?.textContent ?? '') + '@' + Math.round(parseFloat(c.style.left))));
  // Nest the first clip (with its sound).
  await pg.click('.clip--video >> nth=0');
  await pg.keyboard.press('Shift+ArrowRight');
  await pg.click('.clip--video >> nth=0', { button: 'right' });
  await pg.click('text=Nest (put in a sequence of its own)');
  await pg.waitForTimeout(300);
  console.log('after nest', await clips());
  // 3D on the nested clip.
  await pg.click('.clip--video >> nth=0');
  await pg.click('.insp .sect__fold:has-text("3D")');
  const tilt = pg.locator('.prow:has-text("Turn") .scrub');
  await tilt.click();
  await pg.keyboard.press('Control+a');
  await pg.keyboard.type('35');
  await pg.keyboard.press('Enter');
  // Particles above.
  await pg.click('.ed__status');
  await pg.click('.pp .tabs button:nth-child(3)');
  await pg.click('text=Particles');
  await pg.click('.pp .tabs button:nth-child(2)');
  // Glitch on the second V1 clip.
  await pg.click('.clip--video:has-text("Close-up")');
  await pg.click('text=Color fringe (chromatic)');
  await pg.click('.ed__status');
  for (let i = 0; i < 40; i++) await pg.keyboard.press('ArrowRight');
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: S + '/nest1.png' });
  // Play through it.
  await pg.keyboard.press('Space');
  await pg.waitForTimeout(1500);
  await pg.keyboard.press('Space');
  // Open the nest by double-click.
  await pg.dblclick('.clip--video >> nth=0');
  await pg.waitForTimeout(400);
  console.log('inside nest', await clips(), await pg.textContent('.tl__seqs').catch(() => ''));
  await pg.selectOption('.tl__seqs', { index: 0 });
  await pg.waitForTimeout(300);
  // Export 0:00–0:03 at 720p.
  await pg.keyboard.press('Home');
  await pg.keyboard.press('i');
  for (let i = 0; i < 90; i++) await pg.keyboard.press('ArrowRight');
  await pg.keyboard.press('o');
  await pg.keyboard.press('Control+m');
  await pg.click('text=In to out');
  await pg.click('text=1280×720');
  const dl = pg.waitForEvent('download', { timeout: 120000 });
  await pg.click('.modal .btn--primary');
  await (await dl).saveAs(S + '/export2.webm');
  console.log('errors:\n' + errs.join('\n'));
  await b.close();
})();
