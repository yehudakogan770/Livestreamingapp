const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [w, h, f] of [[1440, 900, 'site-edit.png'], [390, 844, 'site-edit-phone.png']]) {
    const pg = await b.newPage({ viewport: { width: w, height: h } });
    await pg.goto('http://localhost:8765/#edit');
    await pg.waitForTimeout(1500);
    await pg.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in', 'is-in', 'shown')));
    await pg.locator('#edit').screenshot({ path: process.argv[2] + '/' + f });
    console.log(w, await pg.evaluate(() => document.documentElement.scrollWidth));
  }
  await b.close();
})();
