const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', proxy: { server: process.env.HTTPS_PROXY || process.env.https_proxy, bypass: 'localhost,127.0.0.1' }, args: ['--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1120 }, ignoreHTTPSErrors: true });
await p.goto('http://localhost:8765/' + process.argv[2]); await p.waitForTimeout(4000);
console.log(await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).join(', ')));
await p.screenshot({ path: 'shots/' + process.argv[3] }); await b.close(); })();
