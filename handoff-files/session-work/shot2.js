const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:8765/Pesukim.dc.html'); await p.waitForTimeout(2500);
await p.screenshot({ path: 'shots/pesukim.png' });
await p.getByRole('button', { name: /Next word/ }).click(); await p.getByRole('button', { name: 'Word + pasuk bar' }).click(); await p.waitForTimeout(300);
await p.screenshot({ path: 'shots/pesukim2.png' });
await p.goto('http://localhost:8765/LogoMaker.dc.html'); await p.waitForTimeout(1500);
await p.getByRole('button', { name: 'Back and forth' }).click();
const a=[]; for (let i=0;i<6;i++){ await p.waitForTimeout(400); a.push(await p.evaluate(()=>[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>/^-?\d+°$/.test(t)))); }
console.log('angles', a.join(' '));
await p.screenshot({ path: 'shots/logo.png' });
await b.close(); })();
