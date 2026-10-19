const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:8765/Main.dc.html'); await p.waitForTimeout(2500);
const r = await p.evaluate(() => { const svg = document.querySelector('svg[viewBox="0 0 160 90"]'); let el = svg, out = []; for (let i = 0; i < 6 && el; i++) { const cs = getComputedStyle(el); out.push(el.tagName + ' ' + (el.getAttribute('style')||'').slice(0,80) + ' | h=' + el.getBoundingClientRect().height + ' disp=' + cs.display); el = el.parentElement; } return out; });
console.log(r.join('\n')); await b.close(); })();
