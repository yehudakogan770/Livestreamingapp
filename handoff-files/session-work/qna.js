const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.getByRole('button', { name: 'Text', exact: true }).click();
  await p.getByText('Live chat and audience questions…').click();
  await p.getByRole('button', { name: '+ Make a chat comments input' }).click();
  await p.getByRole('tab', { name: /Questions/ }).click();
  await p.getByRole('button', { name: /Take questions/ }).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'qna1.png' });
  console.log('errors', errs);
  await b.close();
})();
