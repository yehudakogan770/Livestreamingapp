const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  await p.getByRole('button', { name: 'Event', exact: true }).click();
  await p.getByText('Event look (branding)…').click();
  await p.waitForTimeout(500);
  for (const t of ['Ready-made', 'Words', 'Box', 'Place & motion', 'Fonts']) {
    await p.getByRole('tab', { name: t }).click();
    if (t === 'Ready-made') await p.getByRole('button', { name: /Bold sport/ }).click();
    await p.waitForTimeout(900);
    const sc = await p.evaluate(() => { const m = document.querySelector('.brd__side'); return [m.scrollHeight, m.clientHeight]; });
    console.log(t, sc);
    await p.screenshot({ path: `brand-${t.split(' ')[0]}.png` });
  }
  await p.getByRole('button', { name: 'Apply to everything' }).click();
  console.log('errors', errs);
  await b.close();
})();
