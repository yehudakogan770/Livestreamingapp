const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', proxy: { server: process.env.HTTPS_PROXY } });
  const sites = [['streamyard', 'https://streamyard.com/'], ['ecamm', 'https://www.ecamm.com/'], ['restream', 'https://restream.io/'], ['vmix', 'https://www.vmix.com/'], ['propresenter', 'https://renewedvision.com/propresenter/'], ['riverside', 'https://riverside.fm/']];
  for (const [n, u] of sites) {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })).newPage();
    try {
      await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(5000);
      await p.screenshot({ path: `ref/${n}-0.png` });
      const H = await p.evaluate(() => document.documentElement.scrollHeight);
      for (let i = 1; i <= 3; i++) { await p.evaluate((y) => scrollTo(0, y), Math.min(H - 900, i * 1000)); await p.waitForTimeout(1500); await p.screenshot({ path: `ref/${n}-${i}.png` }); }
      console.log(n, 'ok', H);
    } catch (e) { console.log(n, 'failed', e.message.split('\n')[0]); }
    await p.context().close();
  }
  await b.close();
})();
