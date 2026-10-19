const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.setDefaultTimeout(90000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errs.push(m.text()));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.locator('.titlebar__item', { hasText: /^Inputs$/ }).click();
  await p.getByText('3D logo maker…').click();
  const fc = p.waitForEvent('filechooser'); await p.getByRole('button', { name: 'Choose a logo…' }).click(); await (await fc).setFiles(process.cwd() + '/logo.svg');
  await p.getByRole('button', { name: 'Gold' }).click();
  await p.getByRole('button', { name: 'Gloss' }).click();
  await p.getByRole('button', { name: 'Stop the motion' }).click();
  await p.getByLabel('Angle', { exact: true }).fill('-30');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: 'lm-dialog.png' });
  await p.getByRole('button', { name: 'Moving loop' }).click();
  await p.getByRole('button', { name: 'Logo’s own' }).click();
  await p.waitForTimeout(2500);
  await p.locator('.lm__stage').screenshot({ path: 'lm-loop.png' });
  await p.getByRole('button', { name: 'Export video…' }).click();
  await p.waitForTimeout(500);
  console.log('export notice (browser):', await p.locator('.lm__summary').textContent());
  await p.getByRole('button', { name: 'Add as input' }).click();
  await p.waitForTimeout(500);
  console.log('tiles:', await p.locator('.tile__name').allTextContents());
  // export pipeline with a stand-in client
  const r = await p.evaluate(async () => {
    const { exportLogoVideo } = await import('/src/logo3d/export.ts');
    const { defaultLogo3d } = await import('/src/engine/logo3d.ts');
    let frames = 0, bytes = 0, lit = 0;
    const client = {
      exportStart: async () => 7,
      exportFrame: async (s, d) => { frames++; bytes = d.length; if (frames === 5) for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++; },
      exportFinish: async () => 'done.mov',
      exportCancel: async () => {},
    };
    const path = await exportLogoVideo(client, { ...defaultLogo3d() }, null, { path: 'x', seconds: 1, width: 320, height: 180, fps: 10, format: 'mov' }, () => {}, () => false);
    return { path, frames, bytes, lit };
  });
  console.log('export:', r);
  console.log('errors', errs);
  await b.close();
})();
