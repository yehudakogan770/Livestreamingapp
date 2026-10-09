// Lumora Titler's icons from its mark (titler/src/designer/Mark.tsx):
// the web app's icons (titler/app/public) and the 1024 px picture the desktop
// app's icons are made from (`npx tauri icon titler/src-tauri/app-icon.png
// -o titler/src-tauri/icons`), and the installer's pictures (the NSIS header
// and sidebar, laid out like Lumora's and Studio's). Run: node scripts/titler-icons.mjs
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync('titler/src/designer/Mark.tsx', 'utf8');
const svg = /MARK_SVG = `([^`]+)`/.exec(src)[1].replace('${MARK_VIOLET}', /MARK_VIOLET = '([^']+)'/.exec(src)[1]);
const img = await loadImage(Buffer.from(svg.replace('width="64" height="64"', 'width="1024" height="1024"')));

function png(size, file, pad = 0) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const p = Math.round(size * pad);
  ctx.drawImage(img, p, p, size - 2 * p, size - 2 * p);
  writeFileSync(file, c.encodeSync('png'));
}

mkdirSync('titler/app/public', { recursive: true });
writeFileSync('titler/app/public/icon.svg', svg);
png(32, 'titler/app/public/favicon-32.png');
png(180, 'titler/app/public/icon-180.png');
png(192, 'titler/app/public/icon-192.png');
png(512, 'titler/app/public/icon-512.png');
mkdirSync('titler/src-tauri', { recursive: true });
png(1024, 'titler/src-tauri/app-icon.png', 0.04);
/** A 24-bit Windows bitmap (what NSIS shows) of a canvas. */
function bmp(c, file) {
  const { width: w, height: h } = c;
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * h);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * h, 34);
  out.writeInt32LE(2835, 38);
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = 54 + (h - 1 - y) * row + x * 3;
      out[o] = px[i + 2];
      out[o + 1] = px[i + 1];
      out[o + 2] = px[i];
    }
  writeFileSync(file, out);
}

// The installer: the sidebar (welcome and finish pages) dark with the mark,
// the header (the other pages) white with the mark at the right.
const sidebar = createCanvas(164, 314);
{
  const ctx = sidebar.getContext('2d');
  ctx.fillStyle = '#16171a';
  ctx.fillRect(0, 0, 164, 314);
  ctx.drawImage(img, 36, 75, 92, 92);
}
bmp(sidebar, 'titler/src-tauri/icons/nsis-sidebar.bmp');
const header = createCanvas(150, 56);
{
  const ctx = header.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 150, 56);
  ctx.drawImage(img, 99, 6, 44, 44);
}
bmp(header, 'titler/src-tauri/icons/nsis-header.bmp');
console.log('Titler icons written.');
