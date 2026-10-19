const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 600 } });
  p.setDefaultTimeout(60000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('response', (r) => r.status() >= 400 && errs.push(r.status() + ' ' + r.url())); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  const out = await p.evaluate(async () => {
    const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
    const { emptyShow } = await import('/src/engine/client.ts');
    const { demoApply } = await import('/src/engine/demo.ts');
    let s = emptyShow();
    const t0 = Date.now();
    s = demoApply(s, { type: 'addSource', source: { id: 'v', name: 'Stage visuals', kind: { type: 'visuals' } } }, t0);
    s = demoApply(s, { type: 'cutTo', screen: 'live', sourceId: 'v' }, t0);
    s = demoApply(s, { type: 'visualsScene', scene: { bank: 11, scene: 0 } }, t0);
    s = demoApply(s, { type: 'updateVisuals', patch: { text: { ...s.visuals.text, on: true, words: 'Mazel Tov' } } }, t0);
    const c = new ProgramCompositor({ mediaUrl: (x) => x }, 480, 270);
    c.setShow(s);
    for (let i = 0; i < 20; i++) { c.draw(Date.now()); await new Promise((r) => setTimeout(r, 30)); }
    const g = c.canvas.getContext('2d');
    const d = g.getImageData(0, 0, 480, 270).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return { lit, total: 480 * 270, png: c.canvas.toDataURL() };
  });
  require('fs').writeFileSync('vis-comp.png', Buffer.from(out.png.split(',')[1], 'base64'));
  console.log('compositor lit pixels', out.lit, 'of', out.total);
  console.log('errors', errs);
  await b.close();
})();
