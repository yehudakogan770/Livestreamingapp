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
  const kinds = [
    ['Stage visuals', async () => {}],
    ['Countdown', async () => {}],
    ['Text / title', async () => { await d.getByPlaceholder('[Speaker name]').first().fill('Dana Levine'); await d.getByPlaceholder('[Title]').first().fill('Head of School'); }],
    ['Audience poll', async () => { await d.locator('input').first().fill('Which song should close the night?'); await d.locator('textarea').first().fill('Here Comes the Sun\nDon\'t Stop Believin\'\nSeptember'); }],
    ['Fundraiser', async () => { await d.locator('input').first().fill('The new library wing'); await d.locator('input').nth(1).fill('25,000'); }],
    ['Messages wall', async () => {}],
    ['Microphone', async () => { await p.waitForTimeout(800); await p.screenshot({ path: D + '/ws2-mic.png' }); await d.getByRole('button', { name: 'Fake Audio Input 1' }).click(); await d.getByLabel('Name', { exact: true }).fill('Podium mic'); }],
    ['Microphone', async () => { await p.waitForTimeout(800); await d.getByRole('button', { name: 'Fake Audio Input 2' }).click(); await d.getByLabel('Name', { exact: true }).fill('Handheld mic'); }],
  ];
  for (const [k, fill] of kinds) {
    await p.getByRole('button', { name: /Add input/ }).first().click();
    await p.waitForTimeout(400);
    await d.getByRole('button', { name: k, exact: true }).click();
    await p.waitForTimeout(500);
    await fill().catch((e) => console.log('fill fail', k, e.message.slice(0, 200)));
    await p.waitForTimeout(200);
    await d.getByRole('button', { name: 'Add input', exact: true }).click({ timeout: 3000 }).catch((e) => console.log('add fail', k));
    await p.waitForTimeout(600);
    if (await d.count()) { await p.screenshot({ path: D + '/ws2-fail.png' }); await d.getByRole('button', { name: 'Cancel' }).click(); }
  }
  const tile = (n) => p.locator('.tile__pick[aria-label^="' + n + '"]');
  await tile('1 Stage').dblclick();
  await p.waitForTimeout(1500);
  await tile('4 Which').click();
  await p.waitForTimeout(500);
  await tile('3 Dana').dblclick();
  await p.evaluate(() => document.querySelectorAll('.demo-flag').forEach((e) => e.remove()));
  await p.mouse.move(5, 895);
  await p.waitForTimeout(4000);
  await p.screenshot({ path: D + '/ws2-main.png' });
  console.log(errs);
  await b.close();
})();
