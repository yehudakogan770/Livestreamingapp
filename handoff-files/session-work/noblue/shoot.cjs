// node shoot.cjs <before|after> [only]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const S = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad';
const TAG = process.argv[2] || 'before';
const ONLY = process.argv[3] || '';
const want = (n) => !ONLY || ONLY.split(',').includes(n);
const out = (n) => `${S}/noblue-${TAG}-${n}.png`;
(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errs = [];
  if (want('main') || want('settings') || want('addinput') || want('look') || want('testevent') || want('syscheck') || want('manual') || want('inputsettings') || want('menu')) {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:1437' });
    await ctx.addInitScript({ path: S + '/real/fake-devices.js' });
    const p = await ctx.newPage();
    p.setDefaultTimeout(30000);
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:1437/?shots');
    await p.waitForTimeout(2500);
    await p.getByText('Skip for now').click({ timeout: 2000 }).catch(() => {});
    await p.waitForFunction(() => !!window.__demo, null, { timeout: 30000 });
    await p.evaluate(async () => {
      const d = window.__demo;
      const A = (a) => d.dispatch(a).catch((e) => console.warn('refused', a.type, e?.message ?? e));
      const { TEXT_TEMPLATES } = await import('/src/engine/text.ts');
      await A({ type: 'updateEvent', patch: { name: 'Northwind Summit 2026', setUp: true } });
      for (const [id, label] of window.__CAMS) await A({ type: 'addSource', source: { id, name: label, kind: { type: 'camera', deviceId: id, label } } });
      await A({ type: 'addSource', source: { id: 'slides', name: 'Keynote slides', kind: { type: 'image', path: '/real/real/media/slides.png#Keynote slides.png' } } });
      const lt = TEXT_TEMPLATES[0].make();
      await A({ type: 'addSource', source: { id: 'lt', name: 'Daniel Brooks', kind: { type: 'text', ...lt, text: 'Daniel Brooks', sub: 'Chief Product Officer' } } });
      for (const [id, label] of window.__MICS) await A({ type: 'addSource', source: { id, name: label, kind: { type: 'microphone', deviceId: id, label } } });
      const preset = (id, name, sources) => A({ type: 'addPreset', preset: { id, name, category: '', screen: 'live', sources, transition: null, loadFirst: true, buttons: [] } });
      await preset('p-open', 'Opening', ['cam-wide', 'slides']);
      await preset('p-key', 'Keynote', ['cam-close', 'cam-left', 'slides', 'lt']);
      await preset('p-panel', 'Panel', ['cam-wide', 'cam-left', 'cam-aud']);
      await A({ type: 'pickPreset', id: 'p-key' });
      await A({ type: 'setOverlaySource', channel: 1, sourceId: 'lt' });
      await A({ type: 'setPreview', screen: 'back', sourceId: 'slides' });
      await A({ type: 'cutTo', screen: 'back', sourceId: 'slides' });
      await A({ type: 'setPreview', screen: 'live', sourceId: 'cam-close' });
      await A({ type: 'take', screen: 'live', transition: 'cut' });
      await A({ type: 'setPreview', screen: 'live', sourceId: 'cam-wide' });
    });
    await p.waitForTimeout(800);
    await p.evaluate(async () => {
      const d = window.__demo;
      await d.dispatch({ type: 'setOverlayOn', channel: 1, value: true }).catch(() => {});
      d.captureChanged({ recording: { session: 98, startedAt: Date.now() - 2551000, path: 'Northwind Summit 2026.mp4', destinations: [], bytes: 2.2e9, speed: 1 } });
    });
    await p.waitForTimeout(3000);
    const show = await p.evaluate(async () => JSON.stringify(await window.__demo.getShow()));
    fs.writeFileSync(S + '/noblue/show.json', JSON.stringify(JSON.parse(show).show ?? JSON.parse(show)));
    const shot = async (n) => {
      for (let i = 0; i < 3; i++) {
        try {
          await p.screenshot({ path: out(n), timeout: 60000 });
          break;
        } catch {
          await p.waitForTimeout(1500);
        }
      }
      console.log('shot', n);
    };
    if (want('main')) await shot('main');
    const menu = async (top, item, name, after) => {
      if (!want(name)) return;
      await p.evaluate((top) => [...document.querySelectorAll('.titlebar__item')].find((b) => b.textContent.trim() === top)?.click(), top);
      await p.waitForTimeout(400);
      if (name === 'menu') {
        await shot(name);
        await p.keyboard.press('Escape');
        return;
      }
      await p.evaluate((src) => [...document.querySelectorAll('[role=menuitem]')].find((b) => new RegExp(src, 'i').test(b.textContent))?.click(), item.source);
      await p.waitForTimeout(1500);
      if (after) await after();
      await shot(name);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(500);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
    };
    await menu('Settings', /x/, 'menu');
    await menu('Settings', /Recording and streaming/, 'settings');
    await menu('Inputs', /^Add input/, 'addinput');
    await menu('Event', /look/i, 'look', () => p.waitForTimeout(2500));
    await menu('Settings', /Run a test event/, 'testevent');
    await menu('Help', /Check this computer/, 'syscheck', () => p.waitForTimeout(2500));
    await menu('Help', /How to use/, 'manual');
    if (want('inputsettings')) {
      await p.evaluate(() => {
        const el = [...document.querySelectorAll('[aria-label*="ettings"], [title*="ettings"]')].find((e) => /input|camera|wide/i.test(e.getAttribute('aria-label') + e.title));
        el?.click();
      });
      await p.waitForTimeout(1200);
      await shot('inputsettings');
    }
    await ctx.close();
  }
  if (want('signin')) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.route(/supabase\.co/, (r) => r.fulfill({ status: 401, body: '{}', contentType: 'application/json' }));
    await p.goto('http://localhost:1438/');
    await p.waitForTimeout(4000);
    await p.screenshot({ path: out('signin') });
    console.log('shot signin');
    await ctx.close();
  }
  if (want('remote') || want('slides')) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push('remote: ' + e.message));
    await ctx.addInitScript(() => localStorage.setItem('lumora.remote.pin', '503917'));
    if (want('remote')) {
      await p.goto('http://127.0.0.1:18991/#pin=503917');
      await p.waitForTimeout(2000);
      await p.screenshot({ path: out('remote') });
      await p.screenshot({ path: out('remote-full'), fullPage: true });
      console.log('shot remote');
    }
    if (want('slides')) {
      await p.goto('http://127.0.0.1:18991/slides#pin=503917');
      await p.waitForTimeout(2000);
      await p.screenshot({ path: out('slides') });
      console.log('shot slides');
    }
    await ctx.close();
  }
  console.log('errors', errs.slice(0, 10));
  await b.close();
})();
