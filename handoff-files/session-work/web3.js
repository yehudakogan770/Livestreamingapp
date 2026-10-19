const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', proxy: { server: process.env.HTTPS_PROXY } });
  for (const [w, h, name] of [[1440, 900, 'd'], [390, 844, 'm']]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('file:///home/user/Livestreamingapp/docs/index.html'); await p.waitForTimeout(2000);
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    let i = 0;
    for (let y = 0; y < H; y += h) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(1100); await p.screenshot({ path: `w3${name}-${String(i++).padStart(2, '0')}.png` }); }
    console.log(name, H, 'overflow', over, errs);
  }
  await b.close();
})();
