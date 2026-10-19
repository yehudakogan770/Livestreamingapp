const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  pg.on('console', (m) => m.type() === 'error' && errs.push('CONSOLE ' + m.text()));
  await pg.goto(process.argv[2]);
  await pg.waitForTimeout(1200);
  for (const k of JSON.parse(process.argv[3] || '[]')) await pg.keyboard.press(k);
  await pg.waitForTimeout(500);
  console.log(await pg.evaluate(process.argv[4]));
  console.log(errs.join('\n'));
  await b.close();
})();
