// The website's picture of Lumora Photo (docs/img/photo.jpg, 1920 × 1080):
// the built app (docs/photo) with the hall photo opened, a Curves layer and
// a title on it. Then `npm run site:images` makes the smaller copies.
//
//   npm run photo:build && node e2e/photo-site-shot.mjs

import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docs = resolve(here, '..', 'docs');
const root = join(docs, 'photo');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(root, url.endsWith('/') ? `${url}index.html` : url);
  if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);
  await page.waitForFunction(() => window.__photo);
  const hall = [...readFileSync(join(docs, 'img', 'hall.jpg'))];
  await page.evaluate(async (bytes) => {
    const P = window.__photo;
    await P.openPicked([{ name: 'Evening hall.jpg', bytes: new Uint8Array(bytes) }]);
  }, hall);
  await page.waitForTimeout(800);
  await page.getByRole('tab', { name: 'Adjustments' }).click();
  await page.getByRole('button', { name: 'Curves', exact: true }).first().click();
  await page.waitForTimeout(300);
  // A gentle S curve.
  await page.evaluate(() => {
    const P = window.__photo;
    const s = P.current();
    const l = s.activeLayer();
    s.doc = { ...s.doc, layers: s.doc.layers.map((x) => (x.id === l.id ? { ...x, params: { ...x.params, rgb: [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]] } } : x)) };
    P.app.set((st) => ({ rev: st.rev + 1 }));
  });
  await page.waitForTimeout(600);
  await page.mouse.move(1100, 600);
  await page.screenshot({ path: join(docs, 'img', 'photo.png') });
  writeFileSync(join(docs, 'img', '.photo-shot-done'), '');
} finally {
  await browser.close();
  server.close();
}
