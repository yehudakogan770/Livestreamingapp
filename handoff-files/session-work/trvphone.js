const http = require('http'); const fs = require('fs');
const { chromium } = require('playwright-core');
const posts = [];
let g = { id: 't', title: 'Chanukah Trivia', phase: 'asking', question: 0, text: 'How many nights is Chanukah?', options: ['7', '8', '9', '10'], taking: true, endsAt: Date.now() + 20000, correct: null, players: 3, score: null, place: null, answered: null, points: null };
const srv = http.createServer((q, r) => {
  if (q.url === '/vote') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(fs.readFileSync('/home/user/Livestreamingapp/src-tauri/remote/vote.html')); }
  if (q.url.startsWith('/api/audience')) { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ event: 'Chanukah Party', now: Date.now(), polls: [], questions: false, raffles: [], fundraisers: [], walls: [], auctions: [], trivia: [g] })); }
  let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { posts.push(q.url + ' ' + b); g = { ...g, answered: JSON.parse(b).option }; r.writeHead(200); r.end('{}'); });
}).listen(8798);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:8798/vote');
  await p.waitForTimeout(700);
  await p.getByPlaceholder('Your name').fill('Moshe');
  await p.screenshot({ path: 'trvphone1.png' });
  await p.getByRole('button', { name: /8/ }).click();
  await p.waitForTimeout(800);
  g = { ...g, phase: 'reveal', correct: 1, points: 870, score: 870, place: 1, taking: false };
  await p.waitForTimeout(2500);
  await p.screenshot({ path: 'trvphone2.png' });
  console.log(posts, errs);
  await b.close(); srv.close();
})();
