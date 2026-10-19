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
  await p.getByRole('button', { name: 'Add input' }).first().click();
  await p.getByRole('button', { name: /^Raffle/ }).first().click();
  await p.getByLabel('Prize').fill('A weekend in Jerusalem');
  await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
  await p.locator('.tile__pick').nth(0).dblclick();
  await p.getByRole('button', { name: /Options for / }).first().click();
  await p.getByRole('button', { name: 'Run the raffle…' }).click();
  await p.getByLabel('Names to add').fill('Sarah Levi\nDavid Cohen\nMiriam Katz\nYosef Adler\nChana Gold');
  await p.getByRole('button', { name: 'Add these names' }).click();
  await p.getByRole('button', { name: /Draw a winner/ }).click();
  await p.waitForTimeout(2000);
  await p.screenshot({ path: 'raf1.png' });
  await p.waitForTimeout(5000);
  await p.screenshot({ path: 'raf2.png' });
  await p.keyboard.press('Escape');
  // fundraiser
  await p.getByRole('button', { name: 'Add input' }).first().click();
  await p.getByRole('button', { name: /^Fundraiser/ }).first().click();
  await p.getByLabel('Cause').fill('Build the new Torah school');
  await p.getByLabel('Goal').fill('50000');
  await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
  await p.getByRole('button', { name: /Options for / }).nth(1).click();
  await p.getByRole('button', { name: 'Run the fundraiser…' }).click();
  for (const [n, a, m] of [['The Levi family', '5000', 'In honour of Bubby'], ['Anonymous', '1800', ''], ['David Cohen', '7200', 'Mazel tov!']]) {
    await p.getByLabel('Donor name').fill(n); await p.getByLabel('Amount').fill(a); await p.getByLabel('Message').fill(m);
    await p.getByRole('button', { name: '+ Add a donation' }).click();
  }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'fund1.png' });
  console.log('errors', errs);
  await b.close();
})();
