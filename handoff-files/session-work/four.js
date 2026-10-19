const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  // 1. Hide fades.
  await p.getByRole('button', { name: '12 Pesukim', exact: true }).click();
  await p.getByText('Add the 12 Pesukim bar (ready in Next)').click();
  await p.waitForTimeout(1200);
  await p.evaluate(() => { window.__o = []; let n = 0; requestAnimationFrame(function f() { const e = document.querySelector('.mon--pvw .pes__bar'); window.__o.push(e ? Number(getComputedStyle(e).opacity).toFixed(2) : 'gone'); if (++n < 30) requestAnimationFrame(f); }); });
  await p.keyboard.press('b');
  await p.waitForTimeout(700);
  console.log('Hide:', (await p.evaluate(() => window.__o)).join(' '));
  await p.keyboard.press('b');
  // 2. Type a time.
  await p.getByRole('button', { name: /Add input/ }).first().click();
  const d = p.getByRole('dialog', { name: 'Add input' });
  await d.getByRole('button', { name: 'Test pattern', exact: true }).click();
  await d.getByRole('button', { name: 'Add input', exact: true }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Timer', exact: true }).click();
  await p.getByText('Add a countdown…').click();
  await p.getByRole('dialog', { name: 'Add input' }).getByRole('button', { name: 'Add input', exact: true }).click();
  await p.waitForTimeout(500);
  await p.locator('.cdm__time').click();
  await p.getByLabel(/Go to this time/).fill('0:05');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  console.log('Typed 0:05 →', await p.locator('.cdm__time').textContent());
  // 3. At zero: goes to what is in Next. Countdown on air, the test pattern in Next.
  await p.getByRole('button', { name: 'CUT', exact: true }).click();
  await p.waitForTimeout(300);
  await p.locator('.tile', { hasText: 'Test pattern' }).first().click().catch(() => {});
  await p.keyboard.press('2').catch(() => {});
  await p.waitForTimeout(300);
  console.log('on air', await p.locator('.mon--pgm .mon__head em').textContent(), '| next', await p.locator('.mon--pvw .mon__head em').textContent());
  await p.waitForTimeout(9000);
  console.log('after zero: on air', await p.locator('.mon--pgm .mon__head em').textContent());
  // 4. PANIC: no words over the on-air picture.
  await p.locator('button', { hasText: 'PANIC' }).dblclick();
  await p.waitForTimeout(600);
  console.log('PANIC tag:', await p.locator('.mon__state').textContent().catch(() => 'none'), '| words over picture:', await p.locator('.mon__blanked').count());
  await p.screenshot({ path: 'full/panic.png' });
  console.log('errors', errs);
  await b.close();
})();
