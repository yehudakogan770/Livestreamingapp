const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  const add = async (re) => {
    await p.getByRole('button', { name: 'Add input' }).first().click();
    await p.getByRole('button', { name: re }).first().click();
    await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
  };
  await add(/^Test pattern/);
  await add(/^Colour/);
  await add(/^Scoreboard/);
  await add(/^Text \/ title/);
  // transitions: pick More → Circle, take
  await p.locator('.tile__pick').nth(0).dblclick();
  await p.locator('.tile__pick').nth(1).click();
  await p.getByLabel('More transitions').first().selectOption('iris');
  await p.getByRole('button', { name: /^TAKE/ }).click();
  await p.waitForTimeout(350);
  await p.screenshot({ path: 'qp-iris.png' });
  // scoreboard card
  await p.getByRole('button', { name: /Options for Scoreboard/ }).click();
  await p.getByRole('button', { name: 'Scores and clock…' }).click();
  await p.getByRole('button', { name: '+3' }).first().click();
  await p.getByRole('button', { name: /Start clock/ }).click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: 'qp-score.png' });
  await p.getByRole('button', { name: 'Bar' }).click();
  await p.screenshot({ path: 'qp-score-bar.png' });
  await p.getByRole('button', { name: 'Save names and look' }).click();
  // text designs
  await p.getByRole('button', { name: /Options for / }).nth(3).click();
  await p.getByRole('button', { name: 'Edit text…' }).click();
  await p.getByRole('radio', { name: /Two-tone/ }).click();
  await p.waitForTimeout(900);
  await p.screenshot({ path: 'qp-text.png' });
  await p.keyboard.press('Escape');
  // stinger, midi, playlist dialogs open
  await p.getByLabel('More transitions').first().selectOption('setup');
  await p.screenshot({ path: 'qp-sting.png' });
  await p.getByRole('dialog', { name: 'Stingers' }).getByRole('button', { name: 'Cancel' }).click();
  console.log('errors', errs);
  await b.close();
})();
