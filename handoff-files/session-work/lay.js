const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + __dirname + '/stage.y4m'] });
  for (const [w, h] of [[1280, 760], [1920, 1080]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:1420' });
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
    await p.goto('http://localhost:1420'); await p.waitForTimeout(1500);
    await p.getByText('Skip for now').click().catch(() => {});
    const add = async (kind) => {
      await p.getByRole('button', { name: /Add input/ }).first().click();
      const d = p.getByRole('dialog', { name: 'Add input' });
      await d.getByRole('button', { name: kind, exact: true }).click();
      if (kind === 'Camera') { await p.waitForTimeout(800); await d.getByRole('button', { name: /y4m/ }).first().click(); }
      await d.getByRole('button', { name: 'Add input', exact: true }).click();
      await p.waitForTimeout(500);
    };
    for (const k of ['Camera', 'Countdown', 'Color', 'Test pattern']) await add(k).catch((e) => console.log('add', k, e.message.split('\n')[0]));
    await p.keyboard.press('1'); await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(1200); await p.keyboard.press('2'); await p.waitForTimeout(800);
    const scroll = await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2; }).map((e) => e.className.toString().slice(0, 40) + ' ' + (e.scrollHeight - e.clientHeight)));
    console.log(w, 'scrolling:', scroll);
    await p.screenshot({ path: `lay-${w}.png` });
    if (w === 1280) {
      await p.getByRole('button', { name: 'Settings', exact: true }).click(); await p.waitForTimeout(200);
      await p.getByRole('menuitem', { name: /Arrange the screen/ }).click(); await p.waitForTimeout(400);
      await p.screenshot({ path: 'lay-arrange.png' });
      // Click On air, then Next: they swap. Presets to the right. Make the monitors taller.
      await p.locator('.arr', { hasText: 'On air' }).click(); await p.locator('.arr', { hasText: 'Next' }).click();
      await p.getByRole('button', { name: 'Right', exact: true }).click();
      const sp = await p.locator('.splitter--row').boundingBox();
      await p.mouse.move(sp.x + sp.width / 2, sp.y + 6); await p.mouse.down(); await p.mouse.move(sp.x + sp.width / 2, sp.y + 80, { steps: 8 }); await p.mouse.up();
      await p.getByRole('button', { name: 'Done', exact: true }).click(); await p.waitForTimeout(600);
      await p.screenshot({ path: 'lay-arranged.png' });
      console.log('order', await p.evaluate(() => [...document.querySelectorAll('.stage > *')].map((e) => e.className + ':' + getComputedStyle(e).order)));
    }
    await ctx.close();
  }
  await b.close();
})();
