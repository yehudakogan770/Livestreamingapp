// Lumora Photo in a real browser (Chromium with WebGL): the built web app
// (docs/photo) is served, a document made, painted on, given an adjustment
// layer, a gradient fill and text, and the GPU compositor's picture compared
// with the CPU one; a PSD is written and opened back. Screenshots go to
// SHOTS (default: a temporary folder) so the interface can be looked at.
//
//   npm run photo:build && node e2e/photo-smoke.mjs
// Needs Playwright with Chromium (PLAYWRIGHT_MODULE and CHROMIUM_PATH can
// point at them).

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', 'docs', 'photo');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const shots = process.env.SHOTS ?? mkdtempSync(join(tmpdir(), 'photo-shots-'));
mkdirSync(shots, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(root, url.endsWith('/') ? `${url}index.html` : url);
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/?debug`);
  await page.waitForSelector('.lp-start');
  await page.waitForFunction(() => window.__photo);
  await page.screenshot({ path: join(shots, '01-start.png') });

  // A new HD document from the start screen.
  await page.getByRole('button', { name: /HD 1080p/ }).click();
  await page.waitForSelector('.lp-canvas-wrap canvas');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => window.__photo.current()?.doc.width === 1920), 'new 1920 × 1080 document');

  // A gradient fill layer, a new layer with a brush stroke, a curves adjustment, text.
  await page.evaluate(() => window.__photo.run('layer.fillGradient'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__photo.run('layer.new'));
  await page.keyboard.press('b');
  const box = await page.locator('.lp-canvas-wrap').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 0; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.3 + i * 0.02), box.y + box.height * (0.5 + Math.sin(i / 3) * 0.1));
  await page.mouse.up();
  await page.waitForTimeout(300);
  const painted = await page.evaluate(() => {
    const s = window.__photo.current();
    const l = s.activeLayer();
    return l.kind === 'pixel' && l.raster.tiles.size > 0;
  });
  check(painted, 'brush stroke painted pixels');
  await page.getByRole('tab', { name: 'Adjustments' }).click();
  await page.getByRole('button', { name: 'Curves', exact: true }).first().click();
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__photo.current().activeLayer()?.kind === 'adjust'), 'curves adjustment layer from the Adjustments panel');
  await page.screenshot({ path: join(shots, '02-workspace.png') });

  // Text.
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.25);
  await page.keyboard.type('Lumora Photo');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__photo.allLayers(window.__photo.current().doc.layers).some((l) => l.kind === 'text')), 'type layer');

  // The GPU composite matches the CPU one.
  const diff = await page.evaluate(() => {
    const P = window.__photo;
    const s = P.current();
    const r = { x: 700, y: 400, w: 256, h: 192 };
    const a = P.flatten(s.doc, r);
    const b = P.compositeRect(s.doc, r);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    return worst;
  });
  check(diff < 4 / 255, `GPU and CPU composites agree (largest difference ${(diff * 255).toFixed(2)} levels)`);

  // Layer style dialog, filter dialog.
  await page.evaluate(() => window.__photo.run('layer.style'));
  await page.waitForSelector('[role=dialog][aria-label="Layer Style"]');
  await page.screenshot({ path: join(shots, '03-layer-style.png') });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('treeitem', { name: 'Layer 1' }).click();
  await page.evaluate(() => window.__photo.run('filter.gaussianBlur'));
  await page.waitForSelector('[role=dialog]');
  await page.screenshot({ path: join(shots, '04-filter.png') });
  await page.getByRole('button', { name: 'Cancel' }).click();

  // PSD round trip through the open path.
  const layers = await page.evaluate(async () => {
    const P = window.__photo;
    const s = P.current();
    const bytes = await P.writePSD(s.doc, P.flatten(s.doc, { x: 0, y: 0, w: s.doc.width, h: s.doc.height }));
    await P.openPicked([{ name: 'Round trip.psd', bytes }]);
    return P.allLayers(P.current().doc.layers).map((l) => l.kind);
  });
  check(layers.includes('adjust') && layers.includes('text') && layers.includes('fill'), `PSD round trip keeps layer kinds (${layers.join(', ')})`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, '05-psd.png') });

  // Menus and the light theme.
  await page.getByRole('menubar').getByRole('button', { name: 'Filter' }).dispatchEvent('pointerdown');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(shots, '06-menu.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__photo.app.set({ theme: 'light' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, '07-light.png') });

  check(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`Screenshots: ${shots}`);
if (failures.length) {
  console.error(`${failures.length} check(s) failed.`);
  process.exit(1);
}
