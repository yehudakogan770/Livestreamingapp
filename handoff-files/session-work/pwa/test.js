// PWA checks against the built Planner with a mocked account server (never committed).
// usage: node test.js http://127.0.0.1:8765/Livestreamingapp/planner/ <outdir> <bumpfile>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const [, , base, outDir, bumpFile] = process.argv;
const SHOT = (n) => `${outDir}/${n}.png`;
const PID = '11111111-2222-3333-4444-555555555555';
const UID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp: 4102444800, role: 'authenticated' })}.sig`;
const session = {
  access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
  user: { id: UID, email: 'pat@example.org', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
};
const now = '2026-10-06T18:00:00Z';
const plan = { id: PID, owner: UID, name: 'Fall benefit gala', event_date: '2026-10-06', venue: 'Grand ballroom', start_time: '19:30', notes: '', updated_at: now, updated_by_name: 'Pat' };
let pos = 0;
const cue = (section, title, segment, who, dur, extra = {}) => ({
  id: `00000000-0000-0000-0000-${String(++pos).padStart(12, '0')}`, plan_id: PID, position: pos, section, title, segment, who,
  notes: extra.notes || '', start_time: extra.start || '', duration_sec: dur, input_hint: extra.input || '', overlay_hint: extra.overlay || '',
  transition_hint: extra.tr || '', updated_at: now, updated_by_name: 'Pat',
});
const cues = [
  cue('Pre-show', 'Countdown to start', 'countdown', 'Graphics', 300, { start: '19:25', overlay: 'Countdown' }),
  cue('', 'Welcome slide', 'slide', 'Graphics', 60),
  cue('Opening', 'Wide of the room', 'camera', 'Cam 1', 90, { input: 'Cam 1', tr: 'Fade' }),
  cue('', 'Opening remarks', 'speaker', 'Host', 420, { notes: 'Thank the sponsors by name', input: 'Cam 2', overlay: 'Lower third' }),
  cue('', 'Speaker name', 'title', 'Graphics', 15),
  cue('', 'Award presentation', 'speaker', 'Board chair', 600, { input: 'Cam 2' }),
  cue('', 'Intermission', 'break', '', 900),
  cue('Main', 'Feature video', 'video', 'Playback', 240, { start: '20:10' }),
  cue('', 'Keynote', 'speaker', 'Guest speaker', 1500, { input: 'Cam 2' }),
  cue('', 'Closing and thanks', 'custom', 'Host', null),
];
const sum = (id, name, d, t, venue, role, owner, n) => ({ id, name, event_date: d, venue, start_time: t, role, owner_name: owner, cue_count: n, updated_at: now, updated_by_name: owner });
const list = [
  sum(PID, 'Fall benefit gala', '2026-10-06', '19:30', 'Grand ballroom', 'owner', 'Pat', cues.length),
  sum('22222222-2222-3333-4444-555555555555', 'Annual conference, day 1', '2026-10-14', '09:00', 'Main stage', 'editor', 'Sam', 34),
  sum('33333333-2222-3333-4444-555555555555', 'Annual conference, day 2', '2026-10-15', '09:00', 'Main stage', 'editor', 'Sam', 28),
  sum('44444444-2222-3333-4444-555555555555', 'Product launch', '2026-10-22', '14:00', 'Studio B', 'owner', 'Pat', 18),
  sum('55555555-2222-3333-4444-555555555555', 'Town hall', '2026-10-28', '12:00', 'Atrium', 'viewer', 'Lee', 12),
  sum('66666666-2222-3333-4444-555555555555', 'Fall concert', '2026-11-07', '19:00', 'Concert hall', 'owner', 'Pat', 22),
];
const json = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const GF = __dirname + '/../gfonts/';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: opts.scheme || 'light',
    ...(opts.ua ? { userAgent: opts.ua } : {}), ...(opts.ctx || {}),
  });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(GF + 'fonts.css', 'utf8') }));
  await ctx.route('https://fonts.gstatic.com/**', (r) => {
    const f = r.request().url().replace('https://fonts.gstatic.com/', '').replace(/\//g, '_');
    return r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(GF + f), headers: { 'access-control-allow-origin': '*' } });
  });
  ctx.supabaseHits = 0;
  await ctx.route('**/*supabase.co/**', (r) => {
    ctx.supabaseHits++;
    if (ctx.isOffline) return r.abort('internetdisconnected');
    const u = r.request().url();
    if (u.includes('/auth/v1/user')) return json(r, session.user);
    if (u.includes('/profiles')) return json(r, { id: UID, email: 'pat@example.org', name: 'Pat Morgan', approved: true, blocked: false, is_admin: false, lumora: true });
    if (u.includes('my_planner_plans')) return json(r, list);
    if (u.includes('planner_role')) return json(r, 'owner');
    if (u.includes('planner_messages')) return json(r, []);
    if (u.includes('planner_schedule')) return json(r, []);
    if (u.includes('planner_plans')) return json(r, plan);
    if (u.includes('planner_cues')) return json(r, cues);
    return json(r, []);
  });
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem('lumora.planner')) localStorage.setItem('lumora.planner', s);
  }, JSON.stringify(session));
  return ctx;
}

const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) process.exitCode = 1;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // 1. Installability + offline (Android-like Chromium).
  {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && console.log('  console:', m.text()));
    await page.goto(base);
    await page.waitForSelector('.plancard');
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      return { scope: reg.scope, controlled: !!navigator.serviceWorker.controller, script: reg.active && reg.active.scriptURL };
    });
    ok(sw.controlled && sw.scope.endsWith('/Livestreamingapp/planner/'), `service worker controls the page, scope ${sw.scope}`);
    const manifest = await page.evaluate(async () => {
      const href = document.querySelector('link[rel=manifest]').href;
      const m = await (await fetch(href)).json();
      const abs = (u) => new URL(u, href).href;
      return { start: abs(m.start_url), scope: abs(m.scope), id: abs(m.id), icons: m.icons.map((i) => i.sizes), display: m.display, shots: (m.screenshots || []).map((s) => s.form_factor + ' ' + s.sizes) };
    });
    ok(manifest.start.endsWith('/Livestreamingapp/planner/') && manifest.scope === manifest.start, `manifest start_url/scope ${manifest.start}`);
    ok(manifest.icons.includes('192x192') && manifest.icons.includes('512x512') && manifest.display === 'standalone', 'manifest icons 192/512, standalone');
    ok(manifest.shots.length >= 2, `manifest screenshots: ${manifest.shots.join(', ')}`);
    // Installability as Chrome sees it (CDP).
    const cdp = await ctx.newCDPSession(page);
    const errs = await cdp.send('Page.getInstallabilityErrors').catch((e) => ({ installabilityErrors: [{ errorId: String(e) }] }));
    ok(errs.installabilityErrors.length === 0, `Chrome installability errors: ${JSON.stringify(errs.installabilityErrors)}`);
    const appManifest = await cdp.send('Page.getAppManifest').catch(() => null);
    ok(appManifest && appManifest.errors.length === 0, `manifest parse errors: ${JSON.stringify(appManifest && appManifest.errors)}`);
    // Is any account data in the service worker's caches?
    // Open the plan once so it is copied for offline.
    await page.goto(base + `#/plan/${PID}`);
    await page.waitForSelector('text=Countdown to start');
    await page.waitForTimeout(1500);
    const cached = await page.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url);
      return out;
    });
    ok(!cached.some((u) => /supabase/.test(u)), `nothing from the account server in the SW caches (${cached.length} entries)`);
    // Offline: reload, the shell loads and shows the offline bar with the saved list.
    await ctx.setOffline(true);
    ctx.isOffline = true;
    await page.goto(base + '#/');
    await page.reload();
    await page.waitForSelector('.offbar', { timeout: 10000 }).catch(() => {});
    const offText = await page.locator('.offbar').textContent().catch(() => '');
    ok(/Offline — showing the last saved copy/.test(offText || ''), `offline bar: ${offText}`);
    ok((await page.locator('.plancard').count()) === list.length, 'offline: the saved plans list shows');
    ok((await page.locator('.page__new').count()) === 0, 'offline: no New plan form');
    await page.screenshot({ path: SHOT('pwa-offline-list') });
    await page.locator('.plancard').first().click();
    await page.waitForSelector('text=Countdown to start', { timeout: 10000 }).catch(() => {});
    ok((await page.locator('text=Countdown to start').count()) > 0, 'offline: the saved plan opens');
    ok((await page.locator('.fab').count()) === 0 && (await page.locator('text=View only').count()) === 1, 'offline: the plan is read-only (no add, View only)');
    await page.screenshot({ path: SHOT('pwa-offline') });
    // Back from the plan returns to the list.
    await page.goBack();
    await page.waitForTimeout(400);
    ok((await page.locator('.plancard').count()) > 0, 'back from a plan returns to the list');
    await ctx.setOffline(false);
    ctx.isOffline = false;
    // Signing out clears the copy.
    await page.goto(base + '#/account');
    await page.waitForSelector('text=Sign out');
    await page.locator('button:has-text("Sign out")').click();
    await page.waitForTimeout(800);
    const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('lumora.planner.cache.')));
    ok(left.length === 0, 'sign out clears the offline copy');

    // 2. Update bar: a new sw.js appears.
    const page2 = await ctx.newPage();
    await page2.addInitScript(() => {}); // session cleared above; sign back in:
    await page2.evaluate(() => 0).catch(() => {});
    await page2.goto(base);
    await page2.evaluate((s) => localStorage.setItem('lumora.planner', s), JSON.stringify(session));
    await page2.reload();
    await page2.waitForSelector('.plancard');
    await page.close();
    fs.writeFileSync(bumpFile, String(Date.now()));
    await page2.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page2.waitForSelector('.appbar--update', { timeout: 15000 }).catch(() => {});
    ok((await page2.locator('.appbar--update').count()) === 1, 'update bar shows when a new version is waiting');
    await page2.screenshot({ path: SHOT('pwa-update') });
    const before = await page2.evaluate(() => navigator.serviceWorker.controller.scriptURL && performance.timeOrigin);
    await Promise.all([page2.waitForEvent('load', { timeout: 15000 }).catch(() => null), page2.locator('.appbar--update button:has-text("Reload")').click()]);
    await page2.waitForSelector('.plancard');
    const after = await page2.evaluate(() => performance.timeOrigin);
    ok(after !== before && (await page2.locator('.appbar--update').count()) === 0, 'Reload loads the new version');
    fs.unlinkSync(bumpFile);
    await ctx.close();
  }

  // 3. iPhone install card.
  {
    const ctx = await newCtx(browser, { ua: IPHONE_UA });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForSelector('.install');
    ok((await page.locator('.install').textContent()).includes('Add to Home Screen'), 'iPhone: install card with the Share steps');
    await page.screenshot({ path: SHOT('pwa-install-iphone') });
    await page.locator('.install button[aria-label="Close"]').click();
    await page.reload();
    await page.waitForSelector('.plancard');
    ok((await page.locator('.install').count()) === 0, 'iPhone: the card stays closed');
    await page.goto(base + '#/account');
    await page.waitForSelector('text=Sign out');
    await page.screenshot({ path: SHOT('pwa-account-iphone') });
    await ctx.close();
  }
  // 4. Standalone: no card.
  {
    const ctx = await newCtx(browser, { ua: IPHONE_UA });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForSelector('.plancard');
    ok((await page.locator('.install').count()) === 0, 'installed (standalone): no install card');
    await ctx.close();
  }
  // 5. Pull to refresh.
  {
    const ctx = await newCtx(browser);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForSelector('.plancard');
    const hits = ctx.supabaseHits;
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] });
    await touch('touchStart', 200);
    for (let y = 210; y <= 400; y += 15) await touch('touchMove', y);
    await page.screenshot({ path: SHOT('pwa-pull') });
    await touch('touchEnd', 400);
    await page.waitForTimeout(800);
    ok(ctx.supabaseHits > hits, `pull to refresh reloads the plans (${ctx.supabaseHits - hits} requests)`);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
