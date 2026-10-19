const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage();
  p.on('response', (r) => r.status() === 404 && console.log('404', r.url()));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.waitForTimeout(1500);
  await b.close();
})();
