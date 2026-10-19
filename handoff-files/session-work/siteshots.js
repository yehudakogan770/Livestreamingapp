const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture='+__dirname+'/stage.y4m'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:1420' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:1420'); await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  const tidy = async () => {
    await p.addStyleTag({ content: '.demo-flag{display:none!important}' });
    await p.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (/y4m/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/\S*stage\.y4m/, 'Stage camera'); });
  };
  const add = async (kind) => {
    await p.getByRole('button', { name: /Add input/ }).first().click();
    const d = p.getByRole('dialog', { name: 'Add input' });
    await d.getByRole('button', { name: kind, exact: true }).click();
    if (kind === 'Camera') { await p.waitForTimeout(800); await d.getByRole('button', { name: /y4m/ }).first().click({ timeout: 5000 }); }
    await d.getByRole('button', { name: 'Add input', exact: true }).click();
    await p.waitForTimeout(600);
  };
  for (const k of ['Camera', 'Countdown', 'Color', 'Test pattern']) await add(k).catch((e) => console.log('add', k, e.message.split('\n')[0]));
  const k = async (x, ms = 700) => { await p.keyboard.press(x); await p.waitForTimeout(ms); };
  await k('1'); await k('Enter', 1500); await k('2', 1500);
  await tidy(); await p.screenshot({ path: 'site/main.png' });
  console.log('rects', JSON.stringify(await p.evaluate(() => ['.mon--pvw .mon__screen', '.mon--pgm .mon__screen', '.switch__take'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [q, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }))));
  const menu = async (top, item, file) => {
    try {
      await p.getByRole('button', { name: top, exact: true }).first().click(); await p.waitForTimeout(400);
      await p.getByRole('menuitem', { name: item }).first().click(); await p.waitForTimeout(1200);
      await tidy(); await p.screenshot({ path: 'site/' + file + '.png' });
      await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    } catch (e) { console.log('menu', top, item, e.message.split('\n')[0]); await p.keyboard.press('Escape'); }
  };
  await menu('Event', /look/i, 'look');
  await menu('Help', /How to use/i, 'manual');
  console.log('errors', errs);
  await b.close();
})();
