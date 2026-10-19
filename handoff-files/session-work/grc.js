const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  for (const k of [/^Test pattern/, /^Designed title/]) {
    await p.getByRole('button', { name: 'Add input' }).first().click();
    await p.getByRole('button', { name: k }).first().click();
    await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
  }
  await p.getByRole('button', { name: /Options for / }).nth(1).click();
  await p.getByRole('button', { name: 'Design…' }).click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'grc1.png' });
  // drag the selected element up and right
  const sel = p.locator('.grc__sel');
  const bx = await sel.boundingBox();
  await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
  await p.mouse.down();
  await p.mouse.move(bx.x + bx.width / 2 + 120, bx.y + bx.height / 2 - 150, { steps: 8 });
  await p.mouse.up();
  await p.getByLabel('Words').fill('Rabbi Yehuda Kogan');
  await p.getByLabel('Words').blur();
  await p.getByRole('button', { name: '+ Box' }).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'grc2.png' });
  await p.getByRole('button', { name: '▶ Show it coming in' }).click();
  await p.waitForTimeout(200);
  await p.screenshot({ path: 'grc3.png' });
  const url = await p.evaluate(async () => {
    const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
    const { fromTemplate } = await import('/src/engine/graphic.ts');
    const c = new ProgramCompositor({ mediaUrl: (x) => x }, 1920, 1080);
    c.ctx.fillStyle = '#556'; c.ctx.fillRect(0, 0, 1920, 1080);
    const g = fromTemplate(0); g.elements[2].text = 'Rabbi Yehuda Kogan';
    c.graphic(g, 10000, 0, 1920, 1080);
    return c.canvas.toDataURL('image/png');
  });
  require('fs').writeFileSync('grc-rec.png', Buffer.from(url.split(',')[1], 'base64'));
  console.log('errors', errs);
  await b.close();
})();
