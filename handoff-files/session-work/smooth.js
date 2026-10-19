const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  await p.getByRole('button', { name: '12 Pesukim', exact: true }).click();
  await p.getByText('Add the 12 Pesukim bar (ready in Next)').click();
  await p.waitForTimeout(1500);
  for (let round = 0; round < 2; round++) {
    await p.evaluate(() => {
      window.__o = [];
      const el = () => document.querySelector('.mon--pvw .pes__in');
      let n = 0;
      requestAnimationFrame(function f() {
        const e = el();
        window.__o.push(e ? Number(getComputedStyle(e).opacity).toFixed(2) + ':' + e.textContent.slice(0, 6) : 'none');
        if (++n < 24) requestAnimationFrame(f);
      });
    });
    await p.keyboard.press('Space');
    await p.waitForTimeout(700);
    console.log('after Next:', (await p.evaluate(() => window.__o)).join(' '));
  }
  await b.close();
})();
