// Planner v3 screenshots against a mocked account server (never committed).
// usage: node shots-v3.js http://127.0.0.1:8741/planner/ <prefix> [only,names]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const [, , base, prefix, onlyArg] = process.argv;
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
  cue('', '', 'camera', 'Cam 3', 45),
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
  sum('77777777-2222-3333-4444-555555555555', 'Team offsite', '2026-10-22', '09:30', 'Lake house', 'editor', 'Ana', 9),
];
const at = (h, m) => `2026-10-06T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
const msg = (i, author, name, body, h, m) => ({ id: `m${i}`, plan_id: PID, author, author_name: name, body, created_at: new Date(at(h, m)).toISOString() });
const OTHER = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const messages = [
  msg(1, OTHER, 'Sam Rivera', 'Load-in is done. Sound check starts at 4:30 in the ballroom.', 16, 22),
  msg(2, OTHER, 'Sam Rivera', 'Wireless mics 1–4 are on the lectern.', 16, 24),
  msg(3, UID, 'Pat Morgan', 'Thanks! Can we keep #4 to seven minutes? The board chair needs the full ten for #6.', 17, 5),
  msg(4, 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee', 'Ana Chen', 'Lower third for the host is ready. Doors open at 7.', 18, 40),
  msg(5, OTHER, 'Sam Rivera', 'Cam 3 is on the balcony now, wide on the stage.', 19, 32),
];
let bn = 0;
const blk = (day, s, e, title, location, who, notes = '') => ({ id: `b${++bn}`, plan_id: PID, day, starts: s + ':00', ends: e ? e + ':00' : null, title, location, who, notes, sort: bn, updated_at: now, updated_by_name: 'Pat' });
const blocks = [
  blk('2026-10-06', '14:00', '14:30', 'Crew call', 'Loading dock', 'All crew'),
  blk('2026-10-06', '14:30', '17:00', 'Load-in', 'Grand ballroom', 'Crew, Lights'),
  blk('2026-10-06', '16:30', '17:30', 'Sound check', 'Stage', 'Audio, Host'),
  blk('2026-10-06', '17:30', '18:30', 'Rehearsal', 'Stage', 'Everyone', 'Run the award walk-on twice'),
  blk('2026-10-06', '18:30', '19:00', 'Crew dinner', 'Green room', 'All crew'),
  blk('2026-10-06', '19:00', '19:30', 'Doors', 'Lobby', 'Front of house'),
  blk('2026-10-06', '19:30', '21:30', 'Show', 'Grand ballroom', 'Everyone'),
  blk('2026-10-06', '21:30', '23:00', 'Strike', 'Grand ballroom', 'Crew'),
  blk('2026-10-07', '09:00', '11:00', 'Load-out', 'Loading dock', 'Crew'),
  blk('2026-10-07', '11:00', '11:30', 'Venue walk-through', 'Grand ballroom', 'Pat, Venue manager'),
];
const json = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const { devices } = require('/opt/node22/lib/node_modules/playwright');
async function shot(browser, { name, scheme = 'light', dev, signedIn, hash, sel, extra, width, height }) {
  const ctx = await browser.newContext(
    dev
      ? { ...devices[dev], colorScheme: scheme }
      : { viewport: { width: width || 1440, height: height || 900 }, colorScheme: scheme },
  );
  const page = await ctx.newPage();
  const GF = __dirname + '/gfonts/';
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(GF + 'fonts.css', 'utf8') }));
  await page.route('https://fonts.gstatic.com/**', (r) => {
    const f = r.request().url().replace('https://fonts.gstatic.com/', '').replace(/\//g, '_');
    return r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(GF + f), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.clock.install({ time: new Date('2026-10-06T19:41:00') });
  await page.route('**/*supabase.co/**', (r) => {
    const u = r.request().url();
    if (!signedIn) return json(r, {});
    if (u.includes('/profiles')) return json(r, { id: UID, email: 'pat@example.org', name: 'Pat Morgan', approved: true, blocked: false, is_admin: false, lumora: true });
    if (u.includes('my_planner_plans')) return json(r, list);
    if (u.includes('planner_role')) return json(r, 'owner');
    if (u.includes('planner_messages')) return json(r, [...messages].reverse());
    if (u.includes('planner_schedule')) return json(r, blocks);
    if (u.includes('planner_plans')) return json(r, plan);
    if (u.includes('planner_cues')) return json(r, cues);
    if (u.includes('planner_comments')) return json(r, [{ id: 'c1', plan_id: PID, cue_id: cues[3].id, author: OTHER, author_name: 'Sam Rivera', text: 'Mic 2 for the host', created_at: now }]);
    return json(r, []);
  });
  if (signedIn) await page.addInitScript((s) => {
    localStorage.setItem('lumora.planner', s);
    localStorage.setItem('lumora.planner.chatSeen.11111111-2222-3333-4444-555555555555', String(Date.parse('2026-10-06T17:30:00')));
  }, JSON.stringify(session));
  await page.goto(base + (hash || ''));
  await page.clock.runFor(3000);
  await page.waitForTimeout(800);
  for (const one of [].concat(sel || [])) {
    await page.locator(one).first().click({ timeout: 4000 }).catch(() => console.error('click failed', name, one));
    await page.waitForTimeout(400);
  }
  if (extra) await extra(page);
  await page.waitForTimeout(200);
  console.log(name, await page.evaluate(() => [document.documentElement.dataset.device, document.documentElement.dataset.orient, 'compact' in document.documentElement.dataset, innerWidth, innerHeight].join(' ')));
  await page.screenshot({ path: `${prefix}${name}.png` });
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const only = onlyArg ? onlyArg.split(',') : null;
  const P = `#/plan/${PID}`;
  const DEV = {
    phone: { dev: 'iPhone 15', sel: [] },
    android: { dev: 'Pixel 7', sel: [] },
    'tablet-portrait': { dev: 'iPad Pro 11' },
    'tablet-landscape': { dev: 'iPad Pro 11 landscape' },
    galaxy: { dev: 'Galaxy Tab S4' },
    computer: { width: 1440, height: 900 },
    'computer-narrow': { width: 900, height: 800 },
  };
  const VIEWS = {
    plan: { signedIn: true, hash: P, sel: '.cues__row >> nth=3 >> .cell--title' },
    list: { signedIn: true },
    cal: { signedIn: true, hash: '#/calendar' },
    sched: { signedIn: true, hash: P + '/schedule' },
    chat: { signedIn: true, hash: P + '/chat' },
    signin: {},
    panel: { signedIn: true, hash: P, sel: ['.com__open >> nth=3'] },
    side: { signedIn: true, hash: P, sel: ['.side__toggle'] },
    acct: { signedIn: true, sel: ['.account__btn'] },
    keys: { signedIn: true, hash: P, extra: async (p) => { await p.locator('.cues__row >> nth=1').click({ position: { x: 30, y: 10 } }); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(300); } },
    share: { signedIn: true, hash: P, sel: 'button:has-text("Share")' },
    print: { signedIn: true, hash: P, extra: (p) => p.emulateMedia({ media: 'print' }) },
  };
  const views = (process.env.VIEWS || 'plan').split(',');
  for (const [d, o] of Object.entries(DEV)) {
    if (only && !only.includes(d)) continue;
    for (const v of views) {
      const extra = process.env['X_' + v];
      await shot(browser, { ...VIEWS[v], ...o, name: v === 'plan' ? d : `${d}-${v}` });
    }
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
