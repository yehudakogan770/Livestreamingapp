const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900} });
await p.goto('http://localhost:8765/' + process.argv[2]); await p.waitForTimeout(2500);
await p.screenshot({ path: 'shots/' + process.argv[3] }); await b.close(); })();
