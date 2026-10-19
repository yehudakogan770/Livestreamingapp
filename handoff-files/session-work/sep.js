const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await p.goto('http://localhost:1420'); await p.waitForTimeout(1000);
  for (const [name, plain] of [['sep-bar', false], ['sep-plain', true]]) {
    const url = await p.evaluate(async (plain) => {
      const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
      const { defaultPesukim } = await import('/src/engine/pesukim.ts');
      const d = defaultPesukim(); d.look.plain = plain;
      d.place = { pasuk: 0, word: 2, whole: false, blank: false, intro: false, changedAt: 0 };
      const c = new ProgramCompositor({ mediaUrl: (x) => x }, 1920, 1080);
      c.setShow({ sources: [], event: {} });
      c.ctx.fillStyle = '#556'; c.ctx.fillRect(0, 0, 1920, 1080);
      c.pesukim(d, {}, 5000, 1920, 1080);
      return c.canvas.toDataURL('image/jpeg', 0.8);
    }, plain);
    require('fs').writeFileSync(name + '.jpg', Buffer.from(url.split(',')[1], 'base64'));
  }
  await b.close();
})();
