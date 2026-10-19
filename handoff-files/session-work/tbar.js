const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  for (let round = 0; round < 2; round++) {
    await p.getByRole('button', { name: '12 Pesukim', exact: true }).click();
    await p.locator('[role=menuitem]').first().click();
    await p.waitForTimeout(400);
    console.log('next', await p.locator('.mon--pvw .mon__head').textContent(), 'card', await p.locator('.centre__more').textContent().then((t) => t.slice(0, 40)));
    const t = await p.locator('.tbar__track').boundingBox();
    const tiles = p.locator('.tile, .input-tile, [data-source-id]');
    await p.mouse.move(t.x + 3, t.y + t.height / 2);
    await p.mouse.down();
    for (let i = 1; i <= 20; i++) await p.mouse.move(t.x + (t.width * i) / 20, t.y + t.height / 2);
    await p.mouse.up();
    await p.waitForTimeout(600);
    const h = await p.locator('.tbar__handle').boundingBox();
    console.log('on air', await p.locator('.mon--pgm .mon__head').textContent());
    console.log('round', round, 'handle x', Math.round(h.x - t.x), 'labels', await p.locator('.tbar__labels').textContent());
  }
  console.log('errors', errs);
  await b.close();
})();
