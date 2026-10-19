const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [w, h, name] of [[1440, 900, 'd'], [390, 844, 'm']]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto('file:///home/user/Livestreamingapp/docs/index.html', { waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(1200);
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    let i = 0;
    for (let y = 0; y < H; y += h) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(700); await p.screenshot({ path: `w2${name}-${i++}.png` }); }
    if (name === 'd') {
      await p.evaluate(() => document.querySelector('#try').scrollIntoView());
      await p.waitForTimeout(400);
      await p.click('[data-src="2"]'); await p.click('[data-take]'); await p.waitForTimeout(800); await p.click('[data-title]'); await p.waitForTimeout(700);
      await p.screenshot({ path: 'w2d-demo.png' });
    }
    console.log(name, 'height', H, 'overflow', over, 'shots', i, errs);
  }
  await b.close();
})();
