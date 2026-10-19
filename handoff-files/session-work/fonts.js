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
  await p.getByRole('tab', { name: 'Words' }).click();
  await p.getByRole('button', { name: 'Font', exact: true }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'עברית Hebrew' }).click();
  await p.waitForTimeout(1500);
  console.log('hebrew count', await p.locator('.fpk__font').count(), 'placeholder', await p.getByLabel('Search fonts').getAttribute('placeholder'));
  await p.screenshot({ path: 'fonts-picker.png' });
  await p.getByRole('option', { name: /Suez One/ }).click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: 'fonts-after.png' });
  // The recording draws with it too.
  const url = await p.evaluate(async () => {
    const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
    const c = new ProgramCompositor({ mediaUrl: (x) => x }, 960, 540);
    c.setShow({ sources: [], event: {} });
    c.ctx.fillStyle = '#333'; c.ctx.fillRect(0, 0, 960, 540);
    const t = { layout: 'title', text: 'שלום Hello', sub: '', style: { font: 'Rubik Bubbles', size: 150, weight: 400, color: '#fff', align: 'center', outline: 0, outlineColor: '#000', shadow: false, boxOn: false, boxColor: '#000', boxOpacity: 1, padding: 0, radius: 0, lineHeight: 1.2, letterSpacing: 0, speed: 100, design: 'box', accent: '#fff', animate: false, entrance: 'build', italic: false, uppercase: false, subColor: '', subSize: 60, subFont: '', border: 0, borderColor: '#fff', x: 5, y: 10 } };
    c.text(t, 0, 960, 540);
    await new Promise((r) => setTimeout(r, 1500));
    c.ctx.fillRect(0, 0, 960, 540);
    c.text(t, 0, 960, 540);
    return c.canvas.toDataURL();
  });
  require('fs').writeFileSync('fonts-rec.png', Buffer.from(url.split(',')[1], 'base64'));
  console.log('errors', errs);
  await b.close();
})();
