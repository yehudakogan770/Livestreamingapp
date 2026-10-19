const http = require('http'); const fs = require('fs');
const { chromium } = require('playwright-core');
const posts = [];
const srv = http.createServer((q, r) => {
  if (q.url === '/vote') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(fs.readFileSync('/home/user/Livestreamingapp/src-tauri/remote/vote.html')); }
  if (q.url === '/api/audience') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ event: 'Cohen Wedding', polls: [], questions: false, raffles: [], fundraisers: [], walls: [{ id: 'w', title: 'Messages', prompt: 'Write a blessing for the couple', photos: true }] })); }
  const chunks = []; q.on('data', (c) => chunks.push(c)); q.on('end', () => { const body = Buffer.concat(chunks); posts.push(decodeURIComponent(q.url) + ' ' + body.length + ' bytes, jpeg=' + (body[0] === 0xff && body[1] === 0xd8)); r.writeHead(200); r.end('{}'); });
}).listen(8796);
(async () => {
  // a test photo
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 1100 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => { errs.push('dialog: ' + d.message()); d.dismiss(); });
  await p.goto('http://127.0.0.1:8796/vote');
  await p.waitForTimeout(600);
  await p.getByPlaceholder('Your name').fill('Sarah');
  await p.getByPlaceholder('Your message').fill('Mazel tov! So happy for you both.');
  await p.setInputFiles('input[type=file]', '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/r-card-photo.png');
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'phone1.png' });
  await p.getByRole('button', { name: 'Send' }).click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'phone2.png' });
  console.log(posts, errs);
  await b.close(); srv.close();
})();
