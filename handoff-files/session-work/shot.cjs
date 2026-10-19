// Screenshot the built web Titler (docs/titler) with Playwright.
// node shot.cjs <out.png> [steps...]  steps: "click:<text>" "wait:<ms>" "key:<key>" "template:<name>"
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = '/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0/docs';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(4173, r));
  const out = process.argv[2];
  const steps = process.argv.slice(3);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
  await page.goto('http://localhost:4173' + (process.env.URLPATH || '/titler/'));
  await page.waitForTimeout(1500);
  for (const s of steps) {
    const [k, ...rest] = s.split(':');
    const v = rest.join(':');
    if (k === 'click') await page.getByText(v, { exact: false }).first().click();
    else if (k === 'exact') await page.getByText(v, { exact: true }).first().click();
    else if (k === 'label') await page.getByLabel(v, { exact: true }).first().click();
    else if (k === 'role') {
      const [role, name] = v.split('|');
      await page.getByRole(role, { name }).first().click();
    } else if (k === 'wait') await page.waitForTimeout(Number(v));
    else if (k === 'key') await page.keyboard.press(v);
    else if (k === 'eval') console.log(await page.evaluate(v));
    else if (k === 'canvas') {
      const [x, y] = v.split(',').map(Number);
      await page.mouse.click(x, y);
    }
  }
  await page.screenshot({ path: out });
  await browser.close();
  server.close();
})();
