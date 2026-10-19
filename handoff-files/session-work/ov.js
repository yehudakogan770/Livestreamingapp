const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  const add = async (kind, sw) => { await p.getByRole('button', { name: 'Add input' }).first().click(); await p.getByRole('button', { name: new RegExp('^' + kind) }).last().click(); if (sw) await p.getByRole('button', { name: sw }).click(); await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click(); await p.waitForTimeout(150); };
  await add('Test pattern'); await add('Colour', '#c7372f');
  await p.locator('.tile__pick').nth(0).click(); await p.keyboard.press('Shift+Enter');
  // Overlay 1: the red colour as a corner logo
  await p.locator('.ovbar__btn').first().click();
  await p.getByLabel('Overlay input').selectOption({ label: 'Colour' });
  await p.getByRole('button', { name: 'Logo, top right' }).click();
  await p.screenshot({ path: 'ov-editor.png' });
  // Drag the box a bit left
  const box = await p.getByTestId('overlay-box').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x - 60, box.y + box.height / 2 + 20, { steps: 5 }); await p.mouse.up();
  console.log('x after drag:', await p.getByLabel('Left').inputValue(), 'y:', await p.getByLabel('Top').inputValue());
  await p.getByRole('button', { name: 'Save and put on air' }).click();
  await p.waitForTimeout(900);
  console.log('bar:', await p.locator('.ovbar').textContent(), '| on:', await p.locator('.ovbar__btn.is-on').count());
  console.log('overlay in program:', await p.locator('.mon--pgm [data-overlay]').count(), 'in next:', await p.locator('.mon--pvw [data-overlay]').count());
  await p.locator('.mon--pgm').screenshot({ path: 'ov-program.png' });
  // Record it
  await p.getByRole('button', { name: 'REC' }).click(); await p.waitForTimeout(1500);
  await p.keyboard.press('Shift+Digit1'); await p.waitForTimeout(900);
  console.log('after Shift+1 on:', await p.locator('.ovbar__btn.is-on').count(), 'in program:', await p.locator('.mon--pgm [data-overlay]').count());
  await p.locator('.bc-btn').first().click(); await p.getByRole('button', { name: 'Stop recording' }).click(); await p.waitForTimeout(1000);
  const url = await p.locator('.bc-saved a').getAttribute('href');
  const px = await p.evaluate(async (url) => {
    const v = document.createElement('video'); v.muted = true; v.src = url; document.body.appendChild(v);
    await new Promise((r) => (v.onloadeddata = r));
    const c = document.createElement('canvas'); c.width = 192; c.height = 108; const g = c.getContext('2d');
    const at = async (t) => { v.currentTime = t; await new Promise((r) => (v.onseeked = r)); g.drawImage(v, 0, 0, 192, 108); return Array.from(g.getImageData(137, 21, 1, 1).data).slice(0, 3); };
    return { withOverlay: await at(0.8), afterOff: await at(2.3) };
  }, url);
  console.log('recording pixel in the logo corner:', JSON.stringify(px));
  console.log('errors', errs);
  await b.close();
})();
