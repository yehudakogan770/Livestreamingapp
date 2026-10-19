const http = require('http'); const fs = require('fs');
const { chromium } = require('playwright-core');
const posts = [];
let top = 250, topName = 'Sarah Levi';
const srv = http.createServer((q, r) => {
  if (q.url === '/vote') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(fs.readFileSync('/home/user/Livestreamingapp/src-tauri/remote/vote.html')); }
  if (q.url === '/api/audience') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ event: 'Cohen Wedding', now: Date.now(), polls: [], questions: false, raffles: [], fundraisers: [], walls: [], auctions: [{ id: 'a', title: 'Chinese auction', currency: '$', item: { id: 1, name: 'Silver Kiddush cup', detail: 'Donated by the Levi family', top, topName, min: top + 18, step: 18, sold: false, endsAt: Date.now() + 42000 } }] })); }
  let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { posts.push(q.url + ' ' + b); const j = JSON.parse(b); top = j.amount; topName = j.name; r.writeHead(200); r.end('{}'); });
}).listen(8797);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://127.0.0.1:8797/vote');
  await p.waitForTimeout(700);
  await p.screenshot({ path: 'aucphone1.png' });
  await p.getByPlaceholder('Your name').fill('David Cohen');
  await p.getByRole('button', { name: /^Bid \$268/ }).click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: 'aucphone2.png' });
  console.log(posts, errs);
  await b.close(); srv.close();
})();
