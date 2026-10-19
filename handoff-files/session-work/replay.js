const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('file:///home/user/Livestreamingapp/docs/index.html'); await p.waitForTimeout(800);
  const state = () => p.evaluate(() => document.querySelector('.card').classList.contains('is-in'));
  await p.evaluate(() => document.querySelector('.card').scrollIntoView({ block: 'center' })); await p.waitForTimeout(800);
  const a = await state();
  await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(800);
  const b2 = await state();
  await p.evaluate(() => document.querySelector('.card').scrollIntoView({ block: 'center' })); await p.waitForTimeout(800);
  console.log('in view:', a, '| scrolled away:', b2, '| back again:', await state());
  await b.close();
})();
