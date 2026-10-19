const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1000, height: 600 }, timezoneId: 'America/New_York' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  for (const style of ['card', 'bar']) {
    const url = await p.evaluate(async (style) => {
      const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
      const c = new ProgramCompositor({ mediaUrl: (x) => x }, 1920, 1080);
      c.setShow({ event: { place: { name: 'New York', latMicro: 40712800, lonMicro: -74006000, candleMinutes: 18, israel: false, stopBefore: false, stopMinutes: 10, warnMonitor: true } } });
      c.ctx.fillStyle = '#444'; c.ctx.fillRect(0, 0, 1920, 1080);
      c.zmanim({ style }, new Date('2026-09-25T18:05:00-04:00').getTime(), 1920, 1080);
      return c.canvas.toDataURL('image/png');
    }, style);
    require('fs').writeFileSync('zmrec-' + style + '.png', Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('errors', errs);
  await b.close();
})();
