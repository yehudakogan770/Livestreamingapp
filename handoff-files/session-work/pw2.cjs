const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = '/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850/docs/titler';
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(DIR, p);
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
  res.end(fs.readFileSync(f));
});
server.listen(8766, async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:8766/');
  await page.waitForTimeout(1500);
  await page.getByText('Name and role').first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.screenshot({ path: path.join(__dirname, 'ui-export.png') });
  const dl = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Export' }).click();
  const d = await dl;
  const out = path.join(__dirname, 'exported.zip');
  await d.saveAs(out);
  console.log('zip bytes', fs.statSync(out).size, d.suggestedFilename());
  // Lottie
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByText('Lottie (.json)').click();
  const dl2 = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Export' }).click();
  const d2 = await dl2;
  console.log('lottie', d2.suggestedFilename());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, 'ui-after.png') });
  console.log('errors', errors);
  await browser.close();
  server.close();
});
