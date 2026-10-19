const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errs=[]; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8765/Main.dc.html'); await p.waitForTimeout(2000);
await p.getByRole('button', { name: /All three/ }).click(); await p.waitForTimeout(400);
// space usage: bottom of each card vs bottom of the area
console.log(await p.evaluate(() => { const cards=[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Full controls')).map(b=>b.parentElement.parentElement); return cards.map(c=>{const r=c.getBoundingClientRect(); return Math.round(r.top)+'-'+Math.round(r.bottom);}).join(' ') + ' | area bottom ' + Math.round(cards[0].parentElement.getBoundingClientRect().bottom); }));
const over = await p.evaluate(() => { const out=[]; for (const el of document.querySelectorAll('button, span, label')) { if (el.children.length===0 && el.clientWidth>0 && (el.scrollWidth > el.clientWidth+2 || el.scrollHeight > el.clientHeight+2) && getComputedStyle(el).textOverflow!=='ellipsis') out.push(el.textContent.trim().slice(0,30)); } return [...new Set(out)]; });
console.log('overflow:', over);
const names = () => p.evaluate(() => [...document.querySelectorAll('span')].filter(s => s.style.position==='absolute' && s.style.bottom==='6px').map(s=>s.textContent).join(' / '));
// Back T-bar drag to the end
const t = p.getByRole('slider', { name: 'Back Screen T-bar' }); const r = await t.boundingBox();
await p.mouse.move(r.x+14, r.y+r.height/2); await p.mouse.down(); await p.mouse.move(r.x+r.width*0.5, r.y+r.height/2, {steps:5});
console.log('mid', await t.getAttribute('aria-valuenow')); await p.mouse.move(r.x+r.width-2, r.y+r.height/2, {steps:5}); await p.mouse.up(); await p.waitForTimeout(200);
console.log('after Back T-bar:', await names());
await p.getByRole('button', { name: 'Wipe' }).first().click(); await p.waitForTimeout(100);
console.log('take labels:', (await p.getByRole('button', { name: /^TAKE · / }).allInnerTexts()).join(', '));
await p.getByRole('button', { name: 'Side by side' }).click(); await p.getByRole('button', { name: 'Speak louder' }).click();
await p.getByRole('button', { name: 'Show on monitor' }).last().click(); await p.waitForTimeout(200);
console.log('monitor text:', await p.evaluate(() => [...document.querySelectorAll('span')].some(s => s.textContent === 'Speak louder' && s.style.fontWeight==='700')));
await p.getByRole('button', { name: 'Mute' }).first().click(); await p.waitForTimeout(100);
console.log('mute:', await p.getByRole('button', { name: 'Muted' }).count());
await p.screenshot({ path: 'shots/all2.png' });
console.log('errors', errs); await b.close(); })();
