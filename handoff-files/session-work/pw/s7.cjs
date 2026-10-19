const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  await p.click('text=Full-screen title');
  await p.waitForTimeout(600);
  await shot('z0');
  const names = await p.$$eval('.tt-timeline .tt-name', (els) => els.map((e) => e.textContent));
  console.log(names.join(' | '));
  await p.click(`.tt-timeline .tt-name:text-is("${names[0]}")`);
  await p.waitForTimeout(200);
  const insp = p.locator('[data-testid=titler-inspector]');
  await insp.getByText('Center anchor point').click();
  await insp.getByLabel('3D layer').check();
  await p.waitForTimeout(200);
  const setNum = async (label, v) => {
    const i = insp.getByLabel(label, { exact: true });
    await i.click();
    await i.fill(String(v));
    await i.press('Enter');
    await p.waitForTimeout(150);
  };
  await setNum('Y rotation', 35);
  await setNum('X rotation', -15);
  await setNum('Extrude depth', 60);
  await p.waitForTimeout(400);
  await shot('z1-extrude');
  flush('extrude');
  // camera
  await p.click('.tt-menu .tt-menubtn:has-text("Layer")');
  await p.waitForTimeout(200);
  await shot('z2-layermenu');
  await p.click('text=Camera (for 3D layers)');
  await p.waitForTimeout(300);
  await setNum('Orbit across', -30);
  await setNum('Move away', 600);
  await p.waitForTimeout(400);
  await shot('z3-camera');
  flush('camera');
  // time how long a frame takes
  const ms = await p.evaluate(async () => {
    const t0 = performance.now();
    let n = 0;
    await new Promise((r) => {
      const f = () => (++n < 30 ? requestAnimationFrame(f) : r());
      requestAnimationFrame(f);
    });
    return (performance.now() - t0) / 30;
  });
  console.log('idle frame ms', ms.toFixed(1));
  await p.keyboard.press(' ');
  await p.waitForTimeout(2000);
  await p.keyboard.press(' ');
  await shot('z4-played');
  flush('play');
  await b.close();
})();
