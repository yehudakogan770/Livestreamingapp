import { writeFileSync, mkdirSync } from 'node:fs';
const [url, out] = process.argv.slice(2);
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
const b = Buffer.from(await r.arrayBuffer());
writeFileSync(out, b);
console.log(r.status, b.length);
