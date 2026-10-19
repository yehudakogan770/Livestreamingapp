const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [w, h, name] of [[1366, 800, 'desk'], [390, 844, 'phone']]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('requestfailed', (r) => errs.push('failed ' + r.url()));
    p.on('response', (r) => r.status() >= 400 && errs.push(r.status() + ' ' + r.url()));
    await p.goto('file:///home/user/Livestreamingapp/docs/index.html'); await p.waitForTimeout(500);
    await p.screenshot({ path: `web-${name}.png`, fullPage: true });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (name === 'desk') { await p.click('[data-shot="2"]'); console.log('tab shows', await p.locator('.gallery .is-on img').getAttribute('src')); }
    console.log(name, 'overflow', over, errs);
  }
  await b.close();
})();
