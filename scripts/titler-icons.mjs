// Lumora Titler's icons from its mark (titler/src/designer/Mark.tsx):
// the web app's icons (titler/app/public) and the 1024 px picture the desktop
// app's icons are made from (`npx tauri icon titler/src-tauri/app-icon.png
// -o titler/src-tauri/icons`). Run: node scripts/titler-icons.mjs
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
console.log('Titler icons written.');
