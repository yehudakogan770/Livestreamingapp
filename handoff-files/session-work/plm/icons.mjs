import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [pub, dir] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage();
const shot = async (svgPath, size, out) => {
  const svg = readFileSync(svgPath, 'utf8');
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};
await shot(`${pub}/icon.svg`, 192, `${pub}/icon-192.png`);
await shot(`${pub}/icon.svg`, 512, `${pub}/icon-512.png`);
await shot(`${dir}/icon-maskable.svg`, 512, `${pub}/icon-maskable-512.png`);
await shot(`${dir}/icon-square.svg`, 180, `${pub}/icon-180.png`);
await b.close();
