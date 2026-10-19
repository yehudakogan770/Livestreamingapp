// Drive the Color page: nodes, controls, window + matte, undo. Screenshots go next to this file.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const dir = __dirname;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.setDefaultTimeout(30000);
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errs.push(m.text()));
  await p.goto('http://localhost:1537/?demo');
  await p.waitForTimeout(2500);
  await p.keyboard.press('Shift+Digit2');
  await p.waitForTimeout(800);
  const graph = p.locator('.ngraph');
  console.log('nodes at start:', await graph.locator('.gnode').count());
  await p.screenshot({ path: `${dir}/color-1.png` });

  // Primaries: exposure up with the keyboard (each step is a change that can be undone).
  const exposure = p.getByRole('slider', { name: 'Exposure', exact: true });
  await exposure.focus();
  for (let i = 0; i < 10; i++) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(300);
  console.log('exposure now', await exposure.inputValue(), 'grade effects in clip:', await p.evaluate(() => document.querySelectorAll('.gnode').length));
  await p.getByRole('button', { name: '+ Parallel' }).click();
  await p.getByRole('button', { name: '+ Serial' }).click();
  await p.getByRole('button', { name: '+ Layer' }).click();
  console.log('nodes after adding:', await graph.locator('.gnode').count(), 'groups:', await graph.locator('.ngraph__group').count());
  // A window on the chosen node, with its matte in the viewer.
  await p.getByText('Window (part of the frame)').click().catch(() => {});
  await p.locator('label', { hasText: 'Use a window' }).locator('input').check();
  await p.getByRole('button', { name: 'Matte', exact: true }).click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${dir}/color-2.png` });
  const sample = await p.evaluate(() => {
    const c = document.querySelector('.vmon__canvas');
    return c ? [c.width, c.height] : null;
  });
  console.log('viewer canvas', sample);
  await p.getByRole('button', { name: 'Matte', exact: true }).click();
  // Rename by double-click.
  await graph.locator('.gnode').first().dblclick();
  await p.keyboard.type('Skin');
  await p.keyboard.press('Enter');
  console.log('first label:', await graph.locator('.gnode__label').first().textContent());
  // Undo everything back to the start.
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press('Control+z');
    await p.waitForTimeout(80);
  }
  console.log('nodes after undo:', await graph.locator('.gnode').count(), 'label:', await graph.locator('.gnode__label').first().textContent());
  await p.screenshot({ path: `${dir}/color-3.png` });
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
