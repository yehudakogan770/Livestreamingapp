const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await p.goto('http://localhost:8765/Main.dc.html'); await p.waitForTimeout(1200);
  for (const t of ['Back Screen', 'Monitor']) {
    await p.getByRole('button', { name: new RegExp(t) }).first().click(); await p.waitForTimeout(400);
    await p.screenshot({ path: 'shots/Main-' + t.split(' ')[0] + '.png' });
  }
  await b.close();
})();
