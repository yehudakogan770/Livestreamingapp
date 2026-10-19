const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://localhost:8765/Main.dc.html'); await p.waitForTimeout(2500);
const pgTitle = () => p.evaluate(() => { const s=[...document.querySelectorAll('span')].find(x=>x.textContent==='Program' && x.nextElementSibling); return s && s.nextElementSibling.textContent; });
console.log('pg before', await pgTitle());
const tb = p.getByRole('slider', { name: 'T-bar' }); const r = await tb.boundingBox();
await p.mouse.move(r.x+14, r.y+r.height/2); await p.mouse.down(); await p.mouse.move(r.x+r.width-4, r.y+r.height/2, {steps:10}); await p.mouse.up(); await p.waitForTimeout(500);
console.log('pg after', await pgTitle());
await p.getByRole('button', { name: /Back Screen/ }).first().click();
for (let i=0;i<4;i++){ await p.waitForTimeout(350); await p.screenshot({ path: `shots/back${i}.png` }); }
const n = await p.evaluate(() => document.querySelectorAll('*').length); console.log('nodes', n);
console.log('errors', errs.slice(0,5));
await b.close(); })();
