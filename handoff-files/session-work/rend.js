const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const [, , query, out] = process.argv;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage();
  p.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
  await p.goto('http://localhost:8765/laptop.html?' + query);
  await p.waitForFunction(() => window.done || window.failed, null, { timeout: 180000 });
  const f = await p.evaluate(() => window.failed);
  if (f) { console.log('FAILED', f); process.exit(1); }
  const url = await p.evaluate(() => window.done);
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  await b.close();
})();
