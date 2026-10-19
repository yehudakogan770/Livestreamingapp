const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'tpl');
const server = http.createServer((req, res) => {
  const file = path.join(DIR, decodeURIComponent(req.url.split('?')[0]));
  if (req.url === '/host.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><body style="margin:0;background:#556"><div id="r" style="position:relative;width:960px;height:540px"></div><script type="module">
      const { default: G } = await import('/name-and-role/graphic.mjs');
      customElements.define('lt-g', G);
      const el = document.createElement('lt-g'); document.getElementById('r').appendChild(el);
      await el.load({ data: { name: 'Grace Hopper', role: 'Rear Admiral' }, renderType: 'realtime', renderCharacteristics: { resolution: { width: 960, height: 540 } } });
      window.r1 = await el.playAction({});
      window.ready = true;
    </script>`);
    return;
  }
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/json');
  res.end(fs.readFileSync(file));
});
server.listen(8765, async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // CasparCG / OBS form, from a file:// address with fields in the query.
  await page.goto('file://' + path.join(DIR, 'name-and-role/index.html') + '?autoplay=1&name=Ada%20Lovelace&role=Mathematician');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'pw-page-hold.png') });
  await page.evaluate(() => window.update('<templateData><componentData id="name"><data id="text" value="Grace Hopper"/></componentData></templateData>'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(__dirname, 'pw-page-updated.png') });
  await page.evaluate(() => window.stop());
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => window.lumoraTitle.state());
  console.log('after stop:', state);
  // 9:16 browser source picks the format closest to its shape (if any)
  await page.setViewportSize({ width: 540, height: 960 });
  await page.goto('file://' + path.join(DIR, 'scoreboard-bug/index.html') + '?autoplay=1');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'pw-score-portrait.png') });
  // OGraf web component over http
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('http://localhost:8765/host.html');
  await page.waitForFunction(() => window.ready === true, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  console.log('ograf play result', JSON.stringify(await page.evaluate(() => window.r1)));
  await page.screenshot({ path: path.join(__dirname, 'pw-ograf.png') });
  console.log('errors', errors);
  await browser.close();
  server.close();
});
