const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.setDefaultTimeout(20000);
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  for (const c of ['Colour A', 'Colour B']) {
    await p.getByRole('button', { name: 'Add input' }).first().click();
    await p.getByRole('button', { name: /^Colour/ }).first().click();
    await p.getByRole('dialog').locator('input.text').last().fill(c);
    await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
    await p.waitForTimeout(200);
  }
  await p.locator('.titlebar__item', { hasText: /^Cues$/ }).click();
  await p.getByText('Triggers (when this happens, do that)…').click();
  await p.getByRole('button', { name: '+ Add a trigger' }).click();
  await p.getByLabel('When', { exact: true }).selectOption('onAir');
  await p.getByLabel('Which input').selectOption({ label: 'Colour A' });
  await p.getByLabel('On which screen').selectOption('live');
  await p.getByLabel('Add step').selectOption('cutTo');
  await p.waitForTimeout(300);
  const step = p.locator('.pe__step').first();
  await step.locator('select').nth(0).selectOption({ label: 'Back' });
  await step.locator('select').nth(1).selectOption({ label: 'Colour B' });
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'trg.png' });
  console.log('summary:', await p.locator('.trg__item em').first().textContent());
  await p.keyboard.press('Escape');
  // Put Colour A on the Live Screen: the trigger cuts the Back Screen.
  await p.locator('.tile__pick').nth(0).dblclick();
  await p.waitForTimeout(400);
  await p.keyboard.press('F2');
  await p.waitForTimeout(300);
  console.log('back on air:', await p.locator('.tile--pgm .tile__name').allTextContents());
  console.log('errors', errs);
  await b.close();
})();
