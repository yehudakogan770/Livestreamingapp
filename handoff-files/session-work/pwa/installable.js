// Chrome's own installability check (a non-incognito profile), plus what failed to load.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const base = process.argv[2];
(async () => {
  const dir = fs.mkdtempSync(path.join(__dirname, 'profile-'));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', viewport: { width: 1280, height: 800 } });
  await ctx.route('**/*supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('requestfailed', (r) => console.log('  failed:', r.url().slice(0, 100), r.failure() && r.failure().errorText));
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const e = await cdp.send('Page.getInstallabilityErrors');
  console.log(e.installabilityErrors.length ? 'FAIL ' + JSON.stringify(e.installabilityErrors) : 'PASS installable (no Chrome installability errors)');
  const m = await cdp.send('Page.getAppManifest');
  console.log(m.errors.length ? 'FAIL manifest ' + JSON.stringify(m.errors) : 'PASS manifest parses with no errors');
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
