const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  p.setDefaultTimeout(90000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:1420'); await p.waitForTimeout(1500);
  const svg = 'data:image/svg+xml;base64,' + fs.readFileSync(process.env.SVG || 'logo.svg').toString('base64');
  const shots = await p.evaluate(async ([svg, cases, bevel]) => {
    const { Logo3dRenderer, loadLogo } = await import('/src/logo3d/renderer.ts');
    const prepared = await loadLogo(svg);
    const out = [];
    const base = { path: '', depth: 30, bevel: 8, material: 'metal', color: '#b8c0c8', lightAngle: -40, lightStrength: 0.8, motion: 'swing', swing: 35, ends: 'ease', seconds: 6, angle: 0, playing: false, camera: 0.3, background: 'transparent', bgColor: '#101216', bgScene: { bank: 0, scene: 0 } };
    
    for (const [material, angle, color] of cases) {
      const c = document.createElement('canvas');
      const r = Logo3dRenderer.create(c);
      r.setLogo(prepared);
      r.draw({ ...base, material, angle, color, bevel: out.length ? 8 : 0 }, 0, 480, 270, [0.08, 0.09, 0.11]);
      const t = document.createElement('canvas'); t.width = 480; t.height = 270; t.getContext('2d').drawImage(c, 0, 0);
      out.push(t.toDataURL());
    }
    return out;
  }, [svg, [['matte', 80, '#d4a017'], ['matte', 80, '#d4a017']], 0]);
  // tile into one image via page
  const tiled = await p.evaluate(async (shots) => {
    const c = document.createElement('canvas'); c.width = 960; c.height = 540; const g = c.getContext('2d');
    for (let i = 0; i < shots.length; i++) { const im = new Image(); im.src = shots[i]; await im.decode(); g.drawImage(im, (i % 2) * 480, Math.floor(i / 2) * 270); }
    return c.toDataURL();
  }, shots);
  fs.writeFileSync('l3dz.png', Buffer.from(tiled.split(',')[1], 'base64'));
  console.log('errors', errs);
  await b.close();
})();
