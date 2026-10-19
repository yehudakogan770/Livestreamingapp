const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const S = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [name, w, h] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', deviceScaleFactor: 1, ignoreHTTPSErrors: true });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text()); });
    p.on('requestfailed', (r) => errs.push('failed ' + r.url()));
    await p.goto('http://localhost:8791/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    const wide = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 8).map((e) => e.className || e.tagName));
    console.log(name, 'scrollWidth/innerWidth', sw, 'overflowing:', wide, 'errors:', errs);
    await p.screenshot({ path: S + `site-studio-${name}.png`, fullPage: true });
    if (name === 'desktop') {
      await p.addStyleTag({ content: '.top{visibility:hidden}' }); await p.locator('.hero').screenshot({ path: S + 'site-studio-hero.png' });
      await p.locator('#studio').screenshot({ path: S + 'site-studio-section.png' });
      await p.locator('#studio-features').screenshot({ path: S + 'sst/feat.png' });
      await p.locator('#together').screenshot({ path: S + 'sst/together.png' });
      await p.locator('#download').screenshot({ path: S + 'sst/dl.png' });
      await p.locator('.studio-color').screenshot({ path: S + 'sst/color.png' });
    } else {
      await p.addStyleTag({ content: '.top{visibility:hidden}' }); await p.locator('.hero').screenshot({ path: S + 'sst/phone-hero.png' });
      await p.locator('#download').screenshot({ path: S + 'sst/phone-dl.png' });
      await p.locator('#together').screenshot({ path: S + 'sst/phone-together.png' });
    }
    await ctx.close();
  }
  await b.close();
})();
