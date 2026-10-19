const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  pg.on('response', (r) => r.status() >= 400 && errs.push('HTTP ' + r.status() + ' ' + r.url()));
  pg.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  pg.on('console', (m) => m.type() === 'error' && errs.push('CONSOLE ' + m.text()));
  await pg.goto(process.argv[2] || 'http://localhost:1421/?demo');
  await pg.waitForTimeout(2500);
  const steps = process.argv[4] ? JSON.parse(process.argv[4]) : [];
  for (const s of steps) {
    if (s.key) await pg.keyboard.press(s.key);
    if (s.click) await pg.click(s.click);
    if (s.at) await pg.mouse.click(s.at[0], s.at[1]);
    if (s.type) await pg.keyboard.type(s.type);
    if (s.drag) { await pg.mouse.move(s.drag[0], s.drag[1]); await pg.mouse.down(); await pg.mouse.move((s.drag[0]+s.drag[2])/2, s.drag[3], {steps: 5}); await pg.mouse.move(s.drag[2], s.drag[3], {steps: 5}); if (!s.hold) await pg.mouse.up(); }
    if (s.alt) await pg.keyboard.down('Alt');
    if (s.wait) await pg.waitForTimeout(s.wait);
  }
  await pg.screenshot({ path: process.argv[3] || '/tmp/x.png' });
  const over = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }));
  console.log(JSON.stringify(over), errs.slice(0, 10).join('\n'));
  await b.close();
})();
