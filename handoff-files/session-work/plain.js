const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await p.goto('http://localhost:1420');
  const url = await p.evaluate(async () => {
    const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
    const { defaultPesukim } = await import('/src/engine/pesukim.ts');
    const c = new ProgramCompositor({ mediaUrl: (x) => x }, 1920, 1080);
    c.setShow({ sources: [], event: {} });
    c.ctx.fillStyle = '#f4f4f0'; c.ctx.fillRect(0, 0, 960, 1080);
    c.ctx.fillStyle = '#111'; c.ctx.fillRect(960, 0, 960, 1080);
    const d = defaultPesukim();
    d.look.plain = true;
    d.place = { pasuk: 0, word: 0, whole: false, blank: false, intro: false, changedAt: 0 };
    c.pesukim(d, {}, 5000, 1920, 1080);
    return c.canvas.toDataURL('image/png');
  });
  require('fs').writeFileSync('plain.png', Buffer.from(url.split(',')[1], 'base64'));
  await b.close();
})();
