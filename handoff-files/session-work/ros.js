const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  const add = async (kind, sw) => { await p.getByRole('button', { name: 'Add input' }).first().click(); await p.getByRole('button', { name: new RegExp('^' + kind) }).last().click(); if (sw) await p.getByRole('button', { name: sw }).click(); await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click(); await p.waitForTimeout(150); };
  await add('Test pattern'); await add('Colour', '#c7372f');
  await p.locator('.titlebar__item', { hasText: 'Cues' }).click();
  await p.getByText('Run of show…').click();
  const d = p.getByRole('dialog', { name: 'Run of show' });
  // Cue 1: pattern on air, 3 s long
  await d.getByRole('button', { name: '+ Add a cue' }).click();
  await d.getByLabel('Cue name').fill('Opening');
  await d.getByLabel('Section').fill('Opening');
  await d.getByLabel('Length').fill('0:03'); await d.getByLabel('Section').click();
  await d.getByLabel('Add step').selectOption('cutTo');
  // Cue 2: after previous, colour on air
  await d.getByRole('button', { name: '+ Add a cue' }).click();
  await d.getByLabel('Cue name').fill('Speaker');
  await d.getByRole('button', { name: 'After the previous' }).click();
  await d.getByLabel('Add step').selectOption('cutTo');
  await d.locator('.pe__step select[aria-label="Input"]').last().selectOption({ label: 'Colour' });
  await d.getByLabel('Add step').selectOption('monitorMessage');
  await d.getByRole('button', { name: 'Save cues' }).click();
  await d.getByRole('button', { name: '▶ Start the show' }).click();
  await d.getByRole('button', { name: 'NEXT CUE N' }).click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'ros-dialog.png' });
  await d.getByRole('button', { name: 'Close' }).click();
  console.log('bar after cue 1:', await p.locator('.cuebar').textContent(), '| on air:', await p.locator('.mon--pgm .mon__head em').textContent());
  await p.waitForTimeout(3300);
  console.log('bar after 3 s:', await p.locator('.cuebar').textContent(), '| on air:', await p.locator('.mon--pgm .mon__head em').textContent());
  await p.screenshot({ path: 'ros-bar.png' });
  console.log('errors', errs);
  await b.close();
})();
