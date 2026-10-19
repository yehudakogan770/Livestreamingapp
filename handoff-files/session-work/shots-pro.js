const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [, , base, prefix] = process.argv;
const PID = '11111111-2222-3333-4444-555555555555';
const UID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp: 4102444800, role: 'authenticated' })}.sig`;
const session = {
  access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
  user: { id: UID, email: 'pat@example.org', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
};
const now = '2026-10-06T18:00:00Z';
const plan = { id: PID, owner: UID, name: 'Sunday evening service', event_date: '2026-10-06', venue: 'Main hall', start_time: '19:30', notes: '', updated_at: now, updated_by_name: 'Pat' };
let pos = 0;
const cue = (section, title, segment, who, dur, extra = {}) => ({
  id: `00000000-0000-0000-0000-${String(++pos).padStart(12, '0')}`, plan_id: PID, position: pos, section, title, segment, who,
  notes: extra.notes || '', start_time: extra.start || '', duration_sec: dur, input_hint: extra.input || '', overlay_hint: extra.overlay || '',
  transition_hint: '', updated_at: now, updated_by_name: 'Pat',
});
const cues = [
  cue('Pre-show', 'Countdown to start', 'countdown', 'Graphics', 300, { start: '19:25', overlay: 'Countdown' }),
  cue('', 'Welcome slide', 'slide', 'Graphics', 60),
  cue('Opening', 'Wide of the hall', 'camera', 'Cam 1', 90, { input: 'Cam 1' }),
  cue('', 'Opening song', 'lyrics', 'Worship team', 420, { notes: 'Two verses, chorus twice' }),
  cue('', 'Welcome and announcements', 'speaker', 'Rabbi', 300, { overlay: 'Lower third' }),
  cue('', 'Speaker name', 'title', 'Graphics', 15),
  cue('', 'Intermission', 'break', '', 600),
  cue('Main', 'Feature video', 'video', 'Playback', 240, { start: '19:55' }),
  cue('', 'Talk', 'speaker', 'Guest', 1500),
  cue('', 'Closing', 'custom', '', null),
];
const list = [
  { id: PID, name: 'Sunday evening service', event_date: '2026-10-06', venue: 'Main hall', start_time: '19:30', role: 'owner', owner_name: 'Pat', cue_count: 10, updated_at: now, updated_by_name: 'Pat' },
  { id: '22222222-2222-3333-4444-555555555555', name: 'Fall gala', event_date: '2026-11-14', venue: 'Ballroom', start_time: '18:00', role: 'editor', owner_name: 'Sam', cue_count: 24, updated_at: now, updated_by_name: 'Sam' },
];
const json = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
async function shot(browser, { name, scheme, mobile, signedIn, hash, sel, extra, width, height }) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme }
      : { viewport: { width: width || 1440, height: height || 860 }, colorScheme: scheme },
  );
  const page = await ctx.newPage();
  const GF = __dirname + '/gfonts/';
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: require('fs').readFileSync(GF + 'fonts.css', 'utf8') }));
  await page.route('https://fonts.gstatic.com/**', (r) => {
    const f = r.request().url().replace('https://fonts.gstatic.com/', '').replace(/\//g, '_');
    return r.fulfill({ status: 200, contentType: 'font/woff2', body: require('fs').readFileSync(GF + f), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.clock.install({ time: new Date('2026-10-06T19:41:00') });
  await page.route('**/*supabase.co/**', (r) => {
    const u = r.request().url();
    if (!signedIn) return json(r, {});
    if (u.includes('/profiles')) return json(r, { id: UID, email: 'pat@example.org', name: 'Pat Morgan', approved: true, blocked: false, is_admin: false, lumora: true });
    if (u.includes('my_planner_plans')) return json(r, list);
    if (u.includes('planner_role')) return json(r, 'owner');
    if (u.includes('planner_plans')) return json(r, plan);
    if (u.includes('planner_cues')) return json(r, cues);
    if (u.includes('planner_comments')) return json(r, [{ id: 'c1', plan_id: PID, cue_id: cues[3].id, author: UID, author_name: 'Pat', text: 'Check the mic', created_at: now }]);
    return json(r, []);
  });
  if (signedIn) await page.addInitScript((s) => localStorage.setItem('lumora.planner', s), JSON.stringify(session));
  await page.goto(base + (hash || ''));
  await page.clock.runFor(3000);
  await page.waitForTimeout(800);
  for (const one of [].concat(sel || [])) {
    await page.locator(one).first().click().catch((e) => console.error("click failed", name, one));
    await page.waitForTimeout(400);
  }
  if (extra) await extra(page);
  await page.screenshot({ path: `${prefix}${name}.png` });
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const S = (o) => (!only || only.some((x) => o.name.startsWith(x)) ? shot(browser, o) : null);
  for (const scheme of (process.env.SCHEMES || 'light,dark').split(',')) {
    await S({ name: `signup-${scheme}`, scheme, sel: 'text=Create an account' });
    await S({ name: `share-${scheme}`, scheme, signedIn: true, hash: `#/plan/${PID}`, sel: 'text=Share…' });
    await S({ name: `phonecue-${scheme}`, scheme, mobile: true, signedIn: true, hash: `#/plan/${PID}`, sel: '.card__open >> nth=3' });
    await S({ name: `phonelist-${scheme}`, scheme, mobile: true, signedIn: true });
    await S({ name: `phonesignin-${scheme}`, scheme, mobile: true });
    await S({ name: `account-${scheme}`, scheme, signedIn: true, sel: '.account__btn' });
    await S({ name: `tablet-${scheme}`, scheme, signedIn: true, hash: `#/plan/${PID}`, width: 1024, height: 768 });
    await S({ name: `print-${scheme}`, scheme, signedIn: true, hash: `#/plan/${PID}`, extra: (p) => p.emulateMedia({ media: 'print' }) });
    await S({ name: `signin-${scheme}`, scheme });
    await S({ name: `desktop-plan-${scheme}`, scheme, signedIn: true, hash: `#/plan/${PID}`, sel: '.cues__row >> nth=3 >> .cell--title' });
    await S({ name: `desktop-list-${scheme}`, scheme, signedIn: true });
    await S({ name: `phone-plan-${scheme}`, scheme, mobile: true, signedIn: true, hash: `#/plan/${PID}` });
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
