const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errs=[]; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/Main.dc.html'); await p.waitForTimeout(2000);
const pg = () => p.evaluate(() => { const s=[...document.querySelectorAll('span')].find(x=>x.textContent==='Program' && x.nextElementSibling); return s.nextElementSibling.textContent; });
const tb = p.getByRole('slider', { name: 'T-bar' });
for (const tr of ['Fade','Dip','Wipe']) {
  await p.getByRole('button', { name: new RegExp('^'+tr) }).click();
  const before = await pg();
  await p.getByRole('button', { name: 'TAKE' }).click();
  await p.waitForTimeout(tr==='Wipe'?250:400);
  const mid = await tb.getAttribute('aria-valuenow');
  const ov = await p.evaluate(() => { const d=[...document.querySelectorAll('div')].find(x=>x.style.pointerEvents==='none' && x.style.inset && x.querySelector('dc-import, x-dc, *')); return d ? d.getAttribute('style').slice(0,140) : 'none'; });
  if (tr==='Fade') await p.screenshot({ path: 'shots/take-mid.png', clip: { x: 230, y: 100, width: 1200, height: 300 } });
  await p.waitForTimeout(1300);
  console.log(tr, 'before', before, '| mid tbar', mid, '| after', await pg(), '| tbar', await tb.getAttribute('aria-valuenow'));
  console.log('   overlay', ov);
}
await p.getByRole('button', { name: 'CUT', exact: true }).click(); await p.waitForTimeout(100); console.log('cut ->', await pg());
console.log('errors', errs); await b.close(); })();
(async () => { const { chromium } = require('playwright-core'); const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:8765/Main.dc.html'); await p.waitForTimeout(2000);
const pg = () => p.evaluate(() => [...document.querySelectorAll('span')].filter(x=>x.textContent==='Program' && x.nextElementSibling).map(s=>s.nextElementSibling.textContent).join('/'));
const b0 = await pg(); await p.getByRole('button', { name: 'TAKE' }).click(); await p.waitForTimeout(200);
await p.getByRole('button', { name: 'CUT', exact: true }).click(); await p.waitForTimeout(1500);
console.log('TAKE then CUT mid-way: before', b0, 'after', await pg(), '(should differ)'); await b.close(); })();
