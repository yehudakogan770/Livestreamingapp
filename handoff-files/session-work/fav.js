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
  // Next = Colour B (the last added); take with favourite 2 (Dip 1.5s)
  await p.getByRole('button', { name: 'Dip 1.5s', exact: true }).click();
  await p.waitForTimeout(300);
  console.log('on air after favourite:', await p.locator('.tile--pgm .tile__name').textContent());
  // Change favourite 1 to Wipe 2s
  await p.getByRole('button', { name: 'Change favourite 1' }).click();
  await p.locator('.switch__favpick').getByRole('button', { name: 'Wipe', exact: true }).click();
  await p.locator('.switch__favpick').getByRole('button', { name: '2s', exact: true }).click();
  await p.locator('.switch__favpick').getByRole('button', { name: 'Done' }).click();
  console.log('favourites:', await p.locator('.switch__fav .seg').allTextContents());
  // Quick play Colour A from its tile
  await p.locator('.tile').nth(0).locator('button:has-text("⋯")').first().click();
  await p.locator('.menu__play').getByRole('button', { name: 'Slide 0.6s' }).click();
  await p.waitForTimeout(900);
  console.log('on air after play now:', await p.locator('.tile--pgm .tile__name').textContent());
  await p.getByRole('button', { name: 'Fade to black' }).click();
  await p.waitForTimeout(300);
  console.log('ftb button now:', await p.locator('.switch__ftbbtn').textContent());
  await p.screenshot({ path: 'fav.png' });
  console.log('errors', errs);
  await b.close();
})();
