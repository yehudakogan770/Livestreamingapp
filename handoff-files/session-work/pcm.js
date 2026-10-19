const http = require('http');
const { chromium } = require('playwright-core');
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream' });
  let t = 0;
  const id = setInterval(() => {
    const frames = 960; const b = Buffer.alloc(frames * 4);
    for (let i = 0; i < frames; i++) { const v = Math.round(Math.sin(2 * Math.PI * 440 * (t++) / 48000) * 16000); b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); }
    res.write(b);
  }, 20);
  req.on('close', () => clearInterval(id));
}).listen(8765);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:1420');
  const peak = await p.evaluate(async () => {
    const { PcmStream } = await import('/app/src/audio/pcmStream.ts').catch(() => import('/src/audio/pcmStream.ts'));
    const ctx = new AudioContext();
    await ctx.resume();
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    const g = ctx.createGain(); an.connect(g); g.gain.value = 0; g.connect(ctx.destination);
    new PcmStream(ctx, async () => 'http://127.0.0.1:8765/audio/x', an);
    await new Promise((r) => setTimeout(r, 1500));
    const buf = new Float32Array(2048); an.getFloatTimeDomainData(buf);
    return Math.max(...buf.map(Math.abs));
  });
  console.log('peak', peak.toFixed(3), 'errors', errs);
  await b.close(); srv.close();
})();
