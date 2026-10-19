const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  const cases = [['gold', 3, 1, false], ['royal', 0, 2, false], ['glass', 4, 0, true], ['night', 3, 13, false]];
  for (const [design, pasuk, word, intro] of cases) {
    const url = await p.evaluate(async ([design, pasuk, word, intro]) => {
      const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
      const { defaultPesukim } = await import('/src/engine/pesukim.ts');
      const d = defaultPesukim();
      d.pesukim[pasuk].child = 'Mendel Cohen';
      d.look.design = design;
      d.place = { pasuk, word, whole: false, blank: false, intro, changedAt: 0 };
      const c = new ProgramCompositor({ mediaUrl: (x) => x }, 1920, 1080);
      c.setShow({ sources: [], event: {} });
      const g = c.ctx.createLinearGradient(0, 0, 1920, 1080); g.addColorStop(0, '#556'); g.addColorStop(1, '#a87'); c.ctx.fillStyle = g; c.ctx.fillRect(0, 0, 1920, 1080);
      c.pesukim(d, {}, 5000, 1920, 1080);
      return c.canvas.toDataURL('image/png');
    }, [design, pasuk, word, intro]);
    require('fs').writeFileSync(`pesrec-${design}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  // The screen version (HTML).
  await p.evaluate(async () => {
    const { mount } = await import('/src/zz_preview.tsx');
    const { defaultPesukim } = await import('/src/engine/pesukim.ts');
    const d = defaultPesukim();
    d.place = { pasuk: 11, word: 3, whole: false, blank: false, intro: false, changedAt: 0 };
    document.body.innerHTML = '<div id="x" style="position:fixed;inset:0;width:1280px;height:720px;background:linear-gradient(135deg,#556,#a87);z-index:99999"></div>';
    mount(document.getElementById('x'), d);
  });
  await p.waitForTimeout(800);
  console.log(await p.evaluate(() => { const b = document.querySelector('.pes__bar'); const s = getComputedStyle(b); return [JSON.stringify(b.getBoundingClientRect()), s.left, s.right, s.bottom, s.height, s.position, JSON.stringify(document.querySelector('.pes').getBoundingClientRect())]; }));
  await p.locator('.pes').screenshot({ path: 'pes-html.png' });
  console.log('errors', errs);
  await b.close();
})();
