const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  const r = await p.evaluate(async () => {
    const { FrameDelay } = await import('/src/engine/frameDelay.ts');
    // A "camera" whose picture is the time: red channel = (ms / 4) % 256.
    const src = document.createElement('canvas'); src.width = 64; src.height = 36;
    const g = src.getContext('2d');
    const paint = () => { const v = Math.floor(performance.now() / 4) % 256; g.fillStyle = `rgb(${v},0,0)`; g.fillRect(0, 0, 64, 36); };
    const iv = setInterval(paint, 10); paint();
    const video = document.createElement('video'); video.muted = true; video.srcObject = src.captureStream(60); document.body.append(video); await video.play();
    const d = new FrameDelay(video, 400);
    await new Promise((r) => setTimeout(r, 1500));
    const out = document.createElement('canvas'); out.width = 64; out.height = 36; const o = out.getContext('2d', { willReadFrequently: true });
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const f = d.frame();
      o.drawImage(f, 0, 0);
      const shown = o.getImageData(5, 5, 1, 1).data[0];
      const nowV = Math.floor(performance.now() / 4) % 256;
      samples.push((((nowV - shown) % 256) + 256) % 256 * 4);
      await new Promise((r) => setTimeout(r, 100));
    }
    clearInterval(iv); d.dispose();
    return samples;
  });
  console.log('lag ms (expect about 400):', r, errs);
  await b.close();
})();
