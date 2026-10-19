const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [w, h, size] of [[1670, 887, 'normal'], [1280, 760, 'normal']]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript((s) => localStorage.setItem('lumora.textSize', s), size);
    await p.goto('http://localhost:1420');
    await p.waitForTimeout(1500);
    await p.getByText('Skip for now').click().catch(() => {});
    await p.getByRole('button', { name: /Add input/ }).first().click();
    await p.getByRole('dialog', { name: 'Add input' }).getByRole('button', { name: /^Test pattern/ }).click();
    await p.getByRole('dialog', { name: 'Add input' }).getByRole('button', { name: 'Add input' }).click();
    await p.waitForTimeout(300);
    await p.getByRole('button', { name: 'CUT', exact: true }).click();
    await p.getByRole('button', { name: '12 Pesukim', exact: true }).click();
    await p.getByText('Add the 12 Pesukim bar (ready in Next)').click();
    await p.waitForTimeout(600);
    await p.getByLabel('Go to pasuk').selectOption('11');
    await p.keyboard.press('Space');
    await p.waitForTimeout(600);
    const sc = await p.evaluate(() => { const m = document.querySelector('.centre__more'); return [m.scrollHeight, m.clientHeight]; });
    console.log(w, 'card scroll/visible', sc, errs);
    await p.screenshot({ path: `pcard-${w}.png` });
  }
  await b.close();
})();
