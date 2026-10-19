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
  const d = p.getByRole('dialog', { name: 'Add input' });
  for (const [k, sub] of [['Text / title', 'Title'], ['Color', null]]) {
    await p.getByRole('button', { name: /Add input/ }).first().click();
    await p.waitForTimeout(400);
    await d.getByRole('button', { name: k, exact: true }).click();
    await p.waitForTimeout(500);
    if (sub) await d.getByRole('button', { name: sub, exact: true }).click();
    await p.waitForTimeout(500);
    await p.screenshot({ path: D + '/ws4-' + k.replace(/\W+/g, '') + '.png' });
    console.log(k, await d.locator('input, textarea, select').evaluateAll((els) => els.map((e) => e.tagName + ':' + (e.placeholder || e.value || e.type))));
    await d.getByRole('button', { name: 'Cancel' }).click();
  }
  await b.close();
})();
