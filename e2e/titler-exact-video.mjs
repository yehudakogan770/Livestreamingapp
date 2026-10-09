// Lumora Titler: frame-exact video decoding in a real browser (Chromium's
// WebCodecs). A test film whose every frame has its own brightness (frame n
// is gray level 8·n) is made with FFmpeg (lossless VP9); titler/src/core/exactVideo.ts is
// bundled and asked for the frame at each time of a 30 fps render of a 24 fps
// film (on an https page: WebCodecs needs a secure page). Each frame's
// brightness must be the one showing at that time.
//
//   node e2e/titler-exact-video.mjs
// Needs FFmpeg, and Playwright with Chromium (PLAYWRIGHT_MODULE and
// CHROMIUM_PATH can point at them).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const { build } = await import('vite');

const dir = mkdtempSync(join(tmpdir(), 'titler-exact-'));
try {
  const film = join(dir, 'count.webm');
  const made = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:size=64x64:rate=24',
    '-vf', "geq=lum='min(255,N*8)':cb=128:cr=128",
    // VP9 (Chromium without proprietary codecs decodes it), with alt-ref frames reordering decoding.
    '-t', '2', '-c:v', 'libvpx-vp9', '-lossless', '1', '-g', '12', '-auto-alt-ref', '1', '-lag-in-frames', '8', '-pix_fmt', 'yuv420p', film,
  ]);
  if (made.status !== 0) throw new Error(`FFmpeg: ${made.stderr}`);

  writeFileSync(
    join(dir, 'entry.ts'),
    `import { ExactVideo, mediabunnyFrames } from '${join(root, 'titler/src/core/exactVideo.ts').replace(/\\/g, '/')}';
     (window as any).check = async (url: string) => {
       const v = new ExactVideo(mediabunnyFrames((s) => s));
       const asset = { id: 'v', name: 'v', kind: 'video' as const, src: url };
       const c = new OffscreenCanvas(64, 64);
       const ctx = c.getContext('2d')!;
       const out: number[] = [];
       for (let f = 0; f < 60; f++) {
         const img = await v.frameAt(asset, f / 30);
         ctx.clearRect(0, 0, 64, 64);
         if (img) ctx.drawImage(img, 0, 0);
         out.push(ctx.getImageData(32, 32, 1, 1).data[0]);
       }
       return out;
     };`,
  );
  await build({
    logLevel: 'error',
    configFile: false,
    root: dir,
    build: { outDir: join(dir, 'out'), lib: { entry: join(dir, 'entry.ts'), formats: ['iife'], name: 'exact', fileName: () => 'exact.js' }, minify: false },
  });

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  await page.route('https://titler.test/**', (r) => {
    const name = new URL(r.request().url()).pathname.slice(1);
    if (name === 'count.webm') return r.fulfill({ body: readFileSync(film), contentType: 'video/webm' });
    if (name === 'exact.js') return r.fulfill({ body: readFileSync(join(dir, 'out', 'exact.js')), contentType: 'text/javascript' });
    return r.fulfill({ body: '<!doctype html><meta charset="utf-8"><script src="/exact.js"></script>', contentType: 'text/html' });
  });
  await page.goto('https://titler.test/');
  const got = await page.evaluate(() => window.check('/count.webm'));
  await browser.close();
  const bad = [];
  got.forEach((v, f) => {
    const n = Math.floor((f / 30) * 24 + 1e-6);
    // Gray level Y = 8n (video range) shows as 255/219·(Y − 16); a frame off would be 9 levels or more away.
    const want = Math.max(0, Math.min(255, Math.round(((n * 8 - 16) * 255) / 219)));
    if (Math.abs(v - want) > 3) bad.push({ frame: f, film: n, want, got: v });
  });
  if (bad.length) {
    console.error('Frames not exact:', bad);
    process.exit(1);
  }
  console.log(`Frame-exact: all ${got.length} render frames showed the film's frame for their time.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
