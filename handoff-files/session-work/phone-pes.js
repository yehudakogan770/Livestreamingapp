const { chromium, devices } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:8767');
  await p.fill('#pin', '4321'); await p.click('text=Connect');
  await p.waitForSelector('#pes:not([hidden])');
  console.log('before:', await p.textContent('#pes-now'), '|', await p.textContent('#pes-next'));
  await p.click('#pes-go'); await p.waitForTimeout(400);
  await p.click('#pes-go'); await p.waitForTimeout(400);
  console.log('after 2:', await p.textContent('#pes-now'), '|', await p.textContent('#pes-where'));
  await p.click('#pes-whole'); await p.waitForTimeout(400);
  console.log('whole:', await p.textContent('#pes-now'));
  await p.screenshot({ path: 'phone-pes.png' });
  console.log('errors', errs);
  await b.close();
})();
