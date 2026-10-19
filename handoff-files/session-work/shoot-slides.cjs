const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const out = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad';
const base = 'http://127.0.0.1:18990/slides#pin=503917';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const shots = [
    ['slides-phone-portrait', { width: 390, height: 844 }, true],
    ['slides-phone-landscape', { width: 844, height: 390 }, true],
    ['slides-tablet', { width: 1180, height: 820 }, true],
    ['slides-tablet-portrait', { width: 820, height: 1180 }, true],
  ];
  for (const [name, viewport, mobile] of shots) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(base);
    await page.waitForSelector('#now img');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${name}.png` });
    // Horizontal scroll check.
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(name, 'errors:', errors.length ? errors : 'none', 'overflow:', wide);
    if (name === 'slides-phone-portrait') {
      await page.click('#go');
      await page.waitForTimeout(400);
      console.log('after next:', await page.textContent('#where'));
      await page.click('#all');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/slides-phone-grid.png` });
      await page.click('[data-index="7"]');
      await page.waitForTimeout(400);
      console.log('after jump:', await page.textContent('#where'));
      await page.keyboard.press('PageUp');
      await page.waitForTimeout(400);
      console.log('after PageUp:', await page.textContent('#where'));
      await page.keyboard.press('b');
      await page.waitForTimeout(400);
      console.log('black tag hidden:', await page.isHidden('#black-tag'));
      await page.screenshot({ path: `${out}/slides-phone-black.png` });
      await page.keyboard.press('b');
    }
    await ctx.close();
  }
  await browser.close();
})();
