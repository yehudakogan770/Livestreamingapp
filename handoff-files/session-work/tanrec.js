const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1000, height: 600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  for (const [name, patch] of [['full', {}], ['lower', { look: 'lower', current: 4 }]]) {
    const url = await p.evaluate(async (patch) => {
      const t = await import('/src/engine/tanach.ts');
      await t.loadIndex(); await t.loadBook(26);
      const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
      const c = new ProgramCompositor({ mediaUrl: (x) => x }, 1920, 1080);
      c.ctx.fillStyle = '#556'; c.ctx.fillRect(0, 0, 1920, 1080);
      c.scripture({ ...t.defaultScripture(), ...patch }, 1920, 1080);
      return c.canvas.toDataURL('image/png');
    }, patch);
    require('fs').writeFileSync('tanrec-' + name + '.png', Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('errors', errs);
  await b.close();
})();
