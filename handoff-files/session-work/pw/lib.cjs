const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const DIR = __dirname;
async function start(url = 'http://localhost:1432/', vp = { width: 1600, height: 950 }) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: vp, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 400));
  });
  p.on('response', (r) => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message + '\n' + (e.stack || '').slice(0, 600)));
  p.on('dialog', (d) => { errs.push('dialog: ' + d.message()); d.accept(); });
  await p.goto(url);
  await p.waitForSelector('[data-testid=titler-designer]');
  await p.waitForTimeout(800);
  const shot = (n) => p.screenshot({ path: `${DIR}/${n}.png` });
  const flush = (label) => {
    if (errs.length) console.log(`--- ${label}:\n` + errs.join('\n'));
    errs.length = 0;
  };
  return { b, p, shot, flush, errs };
}
module.exports = { start, DIR };
