const http = require('http'); const fs = require('fs');
const { chromium } = require('playwright-core');
const posts = [];
const srv = http.createServer((q, r) => {
  if (q.url === '/vote') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(fs.readFileSync('/home/user/Livestreamingapp/src-tauri/remote/vote.html')); }
  if (q.url === '/api/audience') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ event: 'Cohen Wedding', polls: [{ id: 'p', round: 1, question: 'Which song next?', options: ['A', 'B'] }], questions: true, raffles: [{ id: 'r', title: 'Grand raffle', prize: 'A weekend in Jerusalem' }], fundraisers: [{ id: 'f', title: 'Build the new Torah school', currency: '$' }] })); }
  let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { posts.push(q.url + ' ' + b); r.writeHead(200); r.end('{}'); });
}).listen(8795);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 1500 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss());
  await p.goto('http://127.0.0.1:8795/vote');
  await p.waitForTimeout(600);
  await p.getByPlaceholder('Your name').first().fill('Sarah');
  await p.getByRole('button', { name: 'Enter the raffle' }).click();
  await p.waitForTimeout(400);
  await p.getByPlaceholder(/Amount/).fill('180');
  await p.getByRole('button', { name: 'Pledge' }).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'aud.png', fullPage: true });
  console.log(posts, errs);
  await b.close(); srv.close();
})();
