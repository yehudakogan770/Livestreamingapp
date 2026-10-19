const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const D = __dirname;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [name, w, h, m] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) for (let t = 0; t < 6; t++) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, isMobile: m, hasTouch: m, deviceScaleFactor: m ? 2 : 1, ignoreHTTPSErrors: true })).newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    p.on('console', (msg) => msg.type() === 'error' && errs.push('console ' + msg.text()));
    p.on('requestfailed', (r) => errs.push('failed ' + r.url()));
    p.on('response', (r) => r.status() >= 400 && errs.push(r.status() + ' ' + r.url()));
    await p.goto('http://127.0.0.1:8931/', { waitUntil: 'networkidle' });
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += 600) { await p.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y); await p.waitForTimeout(150); }
    await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {})))); await p.waitForTimeout(800);
    const info = await p.evaluate(() => {
      const bad = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h.length > 1 && !document.querySelector(h));
      const imgs = [...document.images].map((i) => [i.getAttribute('src'), i.complete && i.naturalWidth > 0]);
      return { overflow: document.documentElement.scrollWidth - innerWidth, bad, imgs: imgs.filter((x) => !x[1]) };
    });
    console.log(name, JSON.stringify(info), errs);
    if (errs.some((e) => e.includes('fonts.g'))) { await p.context().close(); continue; }
    await p.screenshot({ path: `${D}/site-after-${name}.png`, fullPage: true });
    if (name === 'desktop') {
      await p.evaluate(() => document.querySelector('#live').scrollIntoView({ behavior: 'instant' }));
      await p.waitForTimeout(600);
      await p.screenshot({ path: `${D}/site-view-live.png` });
      await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await p.screenshot({ path: `${D}/site-view-top.png` });
    } else {
      await p.screenshot({ path: `${D}/site-view-phone-top.png` });
    }
    break;
  }
  await b.close();
})();
