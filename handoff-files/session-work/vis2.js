const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('response', (r) => r.status() === 404 && errs.push('404 ' + r.url()));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.locator('.titlebar__item', { hasText: /^Visuals$/ }).click();
  await p.getByText('Stage visuals…').click();
  await p.getByRole('button', { name: 'Live Screen', exact: true }).click();
  await p.getByRole('tab', { name: /Party/ }).click();
  await p.getByRole('button', { name: 'Fireworks', exact: true }).click();
  // Keyboard: next scene with Space, flash with X
  await p.waitForTimeout(700);
  await p.keyboard.press('Space');
  await p.waitForTimeout(700);
  console.log('now:', await p.locator('.vis__now').textContent());
  await p.getByRole('tab', { name: 'Effects' }).click();
  await p.locator('.vis__select', { hasText: 'Picture quality' }).locator('select').selectOption('0.5');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.locator('.mon--pgm').screenshot({ path: 'vis-program.png' });
  await p.getByRole('button', { name: 'REC' }).click(); await p.waitForTimeout(3000);
  await p.locator('.bc-btn').first().click(); await p.getByRole('button', { name: 'Stop recording' }).click(); await p.waitForTimeout(900);
  const url = await p.locator('.bc-saved a').getAttribute('href');
  const px = await p.evaluate(async (url) => {
    const v = document.createElement('video'); v.muted = true; v.src = url; document.body.appendChild(v);
    await new Promise((r) => (v.onloadeddata = r)); v.currentTime = 2.2; await new Promise((r) => (v.onseeked = r));
    const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    const big = document.createElement('canvas'); big.width = 480; big.height = 270; big.getContext('2d').drawImage(v, 0, 0, 480, 270);
    return { lit, png: big.toDataURL('image/png') };
  }, url);
  require('fs').writeFileSync('vis-rec.png', Buffer.from(px.png.split(',')[1], 'base64'));
  console.log('recording lit pixels (of 2304):', px.lit);
  console.log('errors', errs);
  await b.close();
})();
