const { chromium } = require('playwright-core'); const fs = require('fs');
const files = process.argv.slice(2);
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const f of files) {
  const p = await b.newPage({ viewport: { width: 1500, height: 2700 } }); const errs = new Set();
  p.on('pageerror', e => errs.add('JS: ' + e.message.slice(0, 120)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fonts.g/.test(m.text())) errs.add('console: ' + m.text().slice(0, 120)); });
  p.on('dialog', d => d.dismiss());
  await p.goto('http://localhost:8765/' + f); await p.waitForTimeout(1200);
  const links = await p.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => !/^(https?:|mailto:|#)/.test(h)));
  for (const h of new Set(links)) if (!fs.existsSync('render/' + h)) errs.add('dead link: ' + h);
  const n = await p.evaluate(() => document.querySelectorAll('button').length);
  const noHandler = [];
  for (let i = 0; i < Math.min(n, 400); i++) {
    const btn = p.locator('button').nth(i);
    try {
      if (!(await btn.isVisible())) continue;
      const txt = ((await btn.getAttribute('aria-label')) || (await btn.innerText())).trim().replace(/\s+/g, ' ').slice(0, 30);
      if (/panic/i.test(txt)) continue;
      const before = await p.evaluate(() => document.body.innerHTML);
      await btn.click({ timeout: 800, force: true }); await p.waitForTimeout(40);
      const after = await p.evaluate(() => document.body.innerHTML);
      if (before === after) noHandler.push(txt);
    } catch (e) {}
    if (p.url().indexOf(f) < 0) { await p.goto('http://localhost:8765/' + f); await p.waitForTimeout(800); }
  }
  console.log('== ' + f + '  buttons ' + n + (errs.size ? '' : '  OK'));
  for (const e of errs) console.log('   ' + e);
  if (noHandler.length) console.log('   no visible effect (' + noHandler.length + '): ' + [...new Set(noHandler)].slice(0, 14).join(' | '));
  await p.close();
}
await b.close(); })();
