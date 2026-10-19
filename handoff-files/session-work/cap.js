const http = require('http'); const fs = require('fs');
const { chromium } = require('playwright-core');
const srv = http.createServer((q, r) => { if (q.url === '/tone.webm') { r.writeHead(200, {'Content-Type':'video/webm'}); r.end(fs.readFileSync('tone.webm')); } else { r.writeHead(200, {'Content-Type':'text/html'}); r.end('<video id=v src=/tone.webm loop></video>'); } }).listen(8777);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:8777/');
  const r = await p.evaluate(async () => {
    const v = document.getElementById('v'); await v.play();
    const ctx = new AudioContext(); await ctx.resume();
    const an = ctx.createAnalyser();
    ctx.createMediaStreamSource(v.captureStream()).connect(an);
    const peak = () => { const b = new Float32Array(2048); an.getFloatTimeDomainData(b); return Math.max(...b.map(Math.abs)); };
    await new Promise((r) => setTimeout(r, 800)); const before = peak();
    v.muted = true; await new Promise((r) => setTimeout(r, 800)); const muted = peak();
    v.muted = false; v.volume = 0; await new Promise((r) => setTimeout(r, 800)); const vol0 = peak();
    return { before, muted, vol0 };
  });
  console.log(r); await b.close(); srv.close();
})();
