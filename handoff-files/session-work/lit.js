const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:8765/Main.dc.html'); await p.waitForTimeout(2000);
const fills = () => p.evaluate(() => [...document.querySelector('svg[style*="transition: none"]').querySelectorAll('path')].map(x => x.getAttribute('fill')).join(','));
console.log('live', await fills());
for (const [t,i] of [['Back Screen',1],['Monitor',2]]) { await p.getByRole('button', { name: new RegExp(t) }).first().click(); await p.waitForTimeout(300); console.log(t, await fills()); await p.screenshot({ path: `shots/lit${i}.png`, clip: { x: 0, y: 0, width: 200, height: 34 } }); }
await b.close(); })();
