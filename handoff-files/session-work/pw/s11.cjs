const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  await p.click('text=Name and role');
  await p.waitForTimeout(500);
  await p.click('.tt-right [data-tab=data]');
  await p.click('button:has-text("Add a data source")');
  const panel = p.locator('.tt-right .tt-dock-body');
  await panel.getByLabel('Source kind').selectOption('csv');
  await panel.getByLabel('Address').fill('data:text/csv,name,role%0AAlex Morgan,Host%0ASam Lee,Producer');
  await panel.getByRole('button', { name: 'Read now' }).click();
  await p.waitForTimeout(800);
  await shot('q1-data');
  console.log(await panel.innerText());
  const row = panel.getByLabel('Row', { exact: true });
  await row.click();
  await row.fill('2');
  await row.press('Enter');
  await panel.getByRole('button', { name: 'Read now' }).click();
  await p.waitForTimeout(800);
  await shot('q2-row2');
  // switch to Layer tab and confirm data reading keeps going (refresh 10 s) – just check no errors
  await p.click('.tt-right [data-tab=look]');
  await p.click('text=Navy');
  await p.waitForTimeout(300);
  await shot('q3-look');
  flush('data/look');
  // Undo history list after many changes
  await p.click('.tt-left [data-tab=history]');
  await p.waitForTimeout(200);
  await shot('q4-history');
  // Save + reload page => recover banner?
  await p.waitForTimeout(2000);
  await p.reload();
  await p.waitForSelector('[data-testid=titler-designer]');
  await p.waitForTimeout(1200);
  await shot('q5-reload');
  console.log('banner', await p.$eval('.tt-banner', (e) => e.textContent).catch(() => 'none'));
  flush('reload');
  await b.close();
})();
