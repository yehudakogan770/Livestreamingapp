const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [w, h] of [[1280, 760], [1920, 1020]]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    await p.goto('http://localhost:1420');
    await p.waitForTimeout(1500);
    await p.getByText('Skip for now').click().catch(() => {});
    await p.evaluate(() => {
      window.__log = [];
      const tick = () => {
        const card = document.querySelector('.centre__more > *');
        if (card) { const r = card.getBoundingClientRect(); window.__log.push(`${card.className.split(" ")[0]}@${Math.round(r.x)},${Math.round(r.y)}`); }
        if (window.__log.length < 40) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await p.getByRole('button', { name: '12 Pesukim', exact: true }).click();
    await p.locator('[role=menuitem]').first().click();
    await p.waitForTimeout(1500);
    const log = await p.evaluate(() => window.__log);
    console.log(w, h, log.join(" "), 'frames', log.length);
  }
  await b.close();
})();
