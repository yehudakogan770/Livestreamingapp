const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.setDefaultTimeout(60000);
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.locator('.titlebar__item', { hasText: /^Inputs$/ }).click();
  await p.getByText('3D logo maker…').click();
  await p.waitForTimeout(800);
  console.log(await p.evaluate(() => ['.lm', '.lm .modal__head', '.lm__body', '.lm .modal__foot', '.lm__left'].map((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return `${s} top=${r.top|0} h=${r.height|0} scrollTop=${e.scrollTop} sh=${e.scrollHeight}`; })));
  await p.screenshot({ path: 'lm-top.png' });
  await b.close();
})();
