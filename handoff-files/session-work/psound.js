const http = require('http'); const fs = require('fs');
const { chromium } = require('playwright-core');
let got = 0, peak = 0, preflight = 0;
const recv = http.createServer((q, r) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Private-Network': 'true' };
  if (q.method === 'OPTIONS') { preflight++; r.writeHead(204, h); return r.end(); }
  const chunks = []; q.on('data', (c) => chunks.push(c)); q.on('end', () => {
    const b = Buffer.concat(chunks); got += b.length;
    for (let i = 0; i + 1 < b.length; i += 2) peak = Math.max(peak, Math.abs(b.readInt16LE(i)));
    r.writeHead(204, h); r.end();
  });
}).listen(8791);
const page = http.createServer((q, r) => { if (q.url === '/tone.webm') { r.writeHead(200, {'Content-Type':'video/webm'}); r.end(fs.readFileSync('tone.webm')); } else { r.writeHead(200, {'Content-Type':'text/html'}); r.end('<video id=v src=/tone.webm loop autoplay></video>'); } }).listen(8792);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  const errs = []; p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const script = fs.readFileSync('/home/user/Livestreamingapp/src-tauri/src/page_sound.js', 'utf8').replace('__PORT__', '8791').replace('__ID__', JSON.stringify('page-1'));
  await p.addInitScript(script);
  await p.goto('http://localhost:8792/');
  await p.waitForTimeout(4000);
  const muted = await p.evaluate(() => document.getElementById('v').muted);
  console.log({ bytes: got, peak, preflight, muted, errs });
  await b.close(); recv.close(); page.close();
})();
