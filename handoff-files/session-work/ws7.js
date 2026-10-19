const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const D = __dirname;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 }); await ctx.grantPermissions(['camera','microphone'], { origin: 'http://localhost:5391' }); const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:5391/');
  await p.waitForTimeout(2500);
  // Event name
  const name = p.getByLabel('Name of the event');
  if (await name.count()) { await name.fill('Spring Gala'); }
  await p.screenshot({ path: D + '/ws2-setup.png' });
  const steps = p.locator('.modal, [role=dialog]').last();
  for (let i = 0; i < 6; i++) {
    const nx = p.getByRole('button', { name: /^(Next|Done|Finish|Start)$/ });
    if (!(await nx.count())) break;
    await nx.last().click().catch(() => {});
    await p.waitForTimeout(300);
  }
  await p.getByText('Skip for now').click().catch(() => {});
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Visuals' }).first().click();
  await p.waitForTimeout(300);
  await p.getByText('Stage visuals…').first().click();
  await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll('.demo-flag').forEach((e) => e.remove()));
  const clickText = (t, sel) => p.evaluate(([t, sel]) => { const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(t)); if (!b) return 'none'; b.click(); return b.className; }, [t, sel]);
  console.log(await clickText('Acoustic', 'button'));
  await p.waitForTimeout(1500);
  console.log(await p.evaluate(() => { const s = [...document.querySelectorAll('.vis__scene')].find((x) => x.textContent.includes('Lanterns')); const b = s && s.querySelector('button'); if (!b) return 'none'; b.click(); return b.className; }));
  await p.waitForTimeout(4000);
  await p.screenshot({ path: D + '/ws7-final.png' });
  await b.close();
})();
