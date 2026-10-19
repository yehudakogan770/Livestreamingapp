const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.setDefaultTimeout(30000);
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // A local page stands in for a website.
  await p.context().route('https://scores.example.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#1b2a4a;color:#fff;font:bold 90px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">HOME 3 – 1 AWAY</body>' }));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.getByRole('button', { name: 'Add input' }).first().click();
  await p.getByRole('button', { name: /^Web page/ }).click();
  await p.getByLabel('Web address').fill('scores.example.com/live');
  await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
  await p.waitForTimeout(500);
  console.log('tiles:', await p.locator('.tile__name').allTextContents(), await p.locator('.tile__kind').allTextContents());
  await p.keyboard.press('Shift+Enter'); // CUT to air
  await p.waitForTimeout(1500);
  await p.locator('.tile').first().locator('button:has-text("⋯")').first().click();
  await p.getByRole('button', { name: 'Control web page…' }).click();
  await p.getByRole('button', { name: 'Zoom in' }).click();
  await p.waitForTimeout(1000);
  await p.screenshot({ path: 'web-card.png' });
  await p.getByLabel('Web address').fill('javascript:alert(1)');
  await p.getByRole('button', { name: 'Go', exact: true }).click();
  console.log('bad url:', await p.locator('[role=alert]').textContent());
  console.log('errors', errs);
  await b.close();
})();
