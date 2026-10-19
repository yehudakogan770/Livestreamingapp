const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  p.on('requestfailed', (r) => console.log('failed', r.url(), r.failure()?.errorText));
  p.on('response', (r) => r.url().includes('web3forms') && r.text().then((t) => console.log('reply', r.status(), t.slice(0, 200))).catch(() => {}));
  await p.goto('https://yehudakogan770.github.io/Livestreamingapp/'); await p.waitForTimeout(800);
  const f = p.locator('[data-feedback]');
  await f.locator('input[name=name]').fill('Lumora setup test');
  await f.locator('textarea[name=message]').fill('This is a test from setting up the Lumora website comment form. If you can read this, the form works.');
  await f.getByRole('button', { name: 'Send' }).click();
  await p.waitForFunction(() => !/Sending/.test(document.querySelector('[data-status]').textContent), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(500);
  console.log('page says:', await p.locator('[data-status]').textContent());
  await b.close();
})();
