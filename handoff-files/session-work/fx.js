const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  const url = await p.evaluate(async () => {
    const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
    const { EFFECTS } = await import('/src/engine/effects.ts');
    const { defaultTextStyle } = await import('/src/engine/text.ts');
    const sheet = document.createElement('canvas'); sheet.width = 1920; sheet.height = 1200;
    const g = sheet.getContext('2d');
    const at = [150, 350];
    let i = 0;
    for (const [kind, name] of EFFECTS) {
      for (const t of at) {
        const c = new ProgramCompositor({ mediaUrl: (x) => x }, 480, 270);
        c.setShow({ sources: [], event: {} });
        c.ctx.fillStyle = '#556'; c.ctx.fillRect(0, 0, 480, 270);
        c.text({ layout: 'lowerThird', text: 'Speaker name', sub: 'Title', style: { ...defaultTextStyle(), entrance: kind, animate: true, design: 'bar' } }, 1000 + t, 480, 270, 1000);
        const col = i % 4, row = Math.floor(i / 4);
        g.drawImage(c.canvas, col * 480, row * 150, 480, 150 * 270 / 270);
        g.fillStyle = '#ff0'; g.font = '20px sans-serif'; g.fillText(`${name} ${t}ms`, col * 480 + 8, row * 150 + 22);
        i++;
      }
    }
    return sheet.toDataURL();
  });
  require('fs').writeFileSync('fx-sheet.png', Buffer.from(url.split(',')[1], 'base64'));
  console.log('errors', errs);
  await b.close();
})();
