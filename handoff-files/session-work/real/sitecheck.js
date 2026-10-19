const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const S = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [w, h, tag] of [
    [1440, 900, 'desktop'],
    [390, 844, 'phone'],
  ]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
    const errs = [];
    const bad = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    p.on('response', (r) => r.status() >= 400 && bad.push(r.status() + ' ' + r.url()));
    await p.goto('http://localhost:8811/');
    await p.waitForTimeout(1500);
    // Scroll through so everything loads and plays.
    const H = await p.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < H; y += 500) {
      await p.evaluate((y) => scrollTo(0, y), y);
      await p.waitForTimeout(150);
    }
    await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-in')));
    const info = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
    }));
    // The switcher with real footage, after a TAKE.
    await p.locator('#demo').scrollIntoViewIfNeeded();
    await p.waitForTimeout(2500);
    await p.locator('[data-title]').click();
    await p.waitForTimeout(1500);
    const vids = await p.evaluate(() => [...document.querySelectorAll('video')].map((v) => v.currentSrc.split('/').pop() + ':' + v.readyState));
    if (tag === 'desktop') {
      await p.locator('#demo').screenshot({ path: S + '/site-real-demo.png' });
      await p.evaluate(() => scrollTo(0, 0));
      await p.waitForTimeout(4500);
      await p.screenshot({ path: S + '/site-real-hero.png' });
      await p.locator('#screens').scrollIntoViewIfNeeded();
      await p.waitForTimeout(1500);
      await p.locator('#screens').screenshot({ path: S + '/site-real-screens.png' });
    }
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${S}/site-real-${tag}.png`, fullPage: true });
    console.log(tag, JSON.stringify(info), vids, 'errors', errs, 'bad', bad);
    await p.close();
  }
  await b.close();
})();
