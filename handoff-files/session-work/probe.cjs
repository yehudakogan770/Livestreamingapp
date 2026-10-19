const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 760 } });
  pg.on('response', (r) => r.status() >= 400 && console.log('HTTP', r.status(), r.url()));
  await pg.goto('http://localhost:1421/?demo');
  await pg.waitForTimeout(3000);
  console.log(await pg.evaluate(() => [...document.querySelectorAll('video')].map((v) => [v.src, v.readyState, v.error && v.error.message, v.duration])));
  await b.close();
})();
