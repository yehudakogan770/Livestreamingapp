const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [w, h] of [[1920, 1020], [1280, 760]]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:1420');
    await p.waitForTimeout(1500);
    await p.getByText('Skip for now').click().catch(() => {});
    // A countdown first (the empty card offers one), then the Pesukim on air.
    await p.getByRole('button', { name: 'Make one and put it in Next' }).click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: '12 Pesukim', exact: true }).click();
    await p.locator('[role=menuitem]').first().click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'CUT', exact: true }).click();
    await p.waitForTimeout(400);
    // The countdown back into Next.
    await p.locator('.tile', { hasText: 'Countdown' }).first().click().catch(async () => console.log('no tile'));
    await p.waitForTimeout(800);
    console.log(w, 'cards', await p.locator('.centre__more > *').evaluateAll((els) => els.map((e) => e.className.split(' ')[0])), 'next', await p.locator('.mon--pvw .mon__head em').textContent(), 'air', await p.locator('.mon--pgm .mon__head em').textContent());
    await p.screenshot({ path: `both-${w}.png` });
    console.log('errors', errs);
  }
  await b.close();
})();
