const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:8765/Main.dc.html'); await p.waitForTimeout(2500);
const hdr = () => p.evaluate(() => [...document.querySelectorAll('span')].filter(x=>x.textContent==='Preview'||x.textContent==='Program').map(x=>x.textContent+':'+(x.nextElementSibling||{}).textContent).join(' | '));
console.log(await hdr());
const tb = p.getByRole('slider', { name: 'T-bar' }); const r = await tb.boundingBox();
await p.mouse.move(r.x+14, r.y+r.height/2); await p.mouse.down();
for (const f of [0.3,0.6,0.9,0.99,1.02]) { await p.mouse.move(r.x+12+(r.width-24)*f, r.y+r.height/2); await p.waitForTimeout(50); console.log(f, await tb.getAttribute('aria-valuenow'), await hdr()); }
await p.mouse.up(); await p.waitForTimeout(300); console.log('up', await hdr());
await b.close(); })();
