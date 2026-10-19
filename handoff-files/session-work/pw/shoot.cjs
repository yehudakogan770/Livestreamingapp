// Screenshots of the Planner with a mocked Supabase backend.
// usage: node shoot.cjs <outdir> [shot names...]
const { chromium } = require('playwright-core');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = process.argv[2] || 'shots';
const ONLY = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });

const ME = '11111111-1111-4111-8111-111111111111';
const PAT = '22222222-2222-4222-8222-222222222222';
const SAM = '33333333-3333-4333-8333-333333333333';
const JO = '44444444-4444-4444-8444-444444444444';
const PLAN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const day = (off) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const iso = (offMin) => new Date(now.getTime() + offMin * 60000).toISOString();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, aal: 'aal1', exp: 4102444800, role: 'authenticated' })}.sig`;
const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'alex@example.com', user_metadata: { name: 'Alex Rivera' }, app_metadata: {}, factors: [], created_at: '2026-01-01T00:00:00Z' };
const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: 4102444800, user };

const summaries = [
  ['Annual conference', day(0), '09:00', 'Main stage', 24],
  ['Product launch', day(0), '14:00', 'Studio B', 12],
  ['Investor briefing', day(0), '16:30', 'Boardroom', 6],
  ['Town hall', day(0), '18:00', 'Auditorium', 9],
  ['Benefit gala', day(6), '18:00', 'Grand ballroom', 31],
  ['Quarterly review', day(2), '10:00', 'Room 4', 8],
  ['Board meeting', day(-3), '13:00', 'Room 2', 5],
  ['Spring concert', day(-20), '19:30', 'City hall', 18],
  ['Awards night', day(12), '19:00', 'Riverside theater', 22],
  ['Press day', day(9), '', 'Studio A', 4],
  ['Podcast taping', day(1), '11:00', 'Studio C', 7],
  ['Workshop', '', '', '', 3],
].map(([name, d, t, venue, cues], i) => ({
  id: i === 0 ? PLAN : `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
  name, event_date: d || null, venue, start_time: t, role: i === 3 ? 'editor' : 'owner', owner_name: 'Alex Rivera', cue_count: cues,
  updated_at: iso(-60 * i), updated_by_name: 'Alex Rivera', time_zone: i === 4 ? 'America/Chicago' : '',
}));

const planRow = { id: PLAN, owner: ME, name: 'Annual conference', event_date: day(0), venue: 'Main stage', start_time: '09:00', notes: '', updated_at: iso(-30), updated_by_name: 'Alex Rivera', time_zone: '', end_by: '17:00', columns: [], is_template: false };
const cueTitles = [['Doors open', 'Pre-show', 'House', 600], ['Welcome', 'Opening', 'Pat Lee', 300], ['Keynote', 'Opening', 'Sam Chen', 1800], ['Panel: the year ahead', 'Main', 'Jo Park', 2400], ['Break', 'Main', '', 900], ['Product demo', 'Main', 'Sam Chen', 1200], ['Awards', 'Close', 'Pat Lee', 900], ['Closing remarks', 'Close', 'Alex Rivera', 300]];
const cues = cueTitles.map(([title, section, who, dur], i) => ({ id: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`, plan_id: PLAN, position: (i + 1) * 1024, section, title, segment: '', who, notes: '', start_time: '', duration_sec: dur, input_hint: '', overlay_hint: '', transition_hint: '', updated_at: iso(-100), updated_by_name: 'Alex Rivera' }));

const msgs = [
  [PAT, 'Pat Lee', -60 * 26, 'Morning all. Run of show is locked for tomorrow.'],
  [PAT, 'Pat Lee', -60 * 26 + 1, 'Call time is 7:30 at the loading dock.'],
  [ME, 'Alex Rivera', -60 * 25, 'Thanks. I moved the keynote to #3 so the welcome lands first.'],
  [SAM, 'Sam Chen', -60 * 24, 'Works for me.'],
  [SAM, 'Sam Chen', -90, 'Mics 3 and 4 are on fresh batteries.'],
  [SAM, 'Sam Chen', -89, 'Lav for the panel is on the table stage left.'],
  [SAM, 'Sam Chen', -88, 'Also, the confidence monitor needs a second HDMI run. Can someone grab one from the truck before doors?'],
  [ME, 'Alex Rivera', -40, 'On it.'],
  [ME, 'Alex Rivera', -39, '@Jo Park can you check the lower thirds for #4 before we go?'],
  [JO, 'Jo Park', -12, 'Lower thirds look good. Fixed a typo in the panel names.'],
  [PAT, 'Pat Lee', -3, 'Doors in ten minutes.'],
];
const messages = msgs.map(([author, author_name, at, body], i) => ({ id: `mmmmmmmm-mmmm-4mmm-8mmm-${String(i).padStart(12, '0')}`.replace(/m/g, 'd'), plan_id: PLAN, author, author_name, body, created_at: iso(at) })).reverse();
const people = [
  { user_id: ME, email: 'alex@example.com', name: 'Alex Rivera', role: 'owner' },
  { user_id: PAT, email: 'pat@example.com', name: 'Pat Lee', role: 'editor' },
  { user_id: SAM, email: 'sam@example.com', name: 'Sam Chen', role: 'editor' },
  { user_id: JO, email: 'jo@example.com', name: 'Jo Park', role: 'viewer' },
];

function rest(url, method, accept) {
  const u = new URL(url);
  const p = u.pathname;
  const single = (accept || '').includes('vnd.pgrst.object');
  if (p.startsWith('/auth/v1/user')) return user;
  if (p.startsWith('/auth/v1/')) return {};
  const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(p);
  if (rpc) {
    switch (rpc[1]) {
      case 'my_planner_plans': return summaries;
      case 'planner_people': return people;
      case 'planner_role': return 'owner';
      case 'sign_in_rules': return null;
      case 'sign_ups_open': return true;
      case 'planner_clock': return now.toISOString();
      case 'planner_my_feed': return null;
      default: return null;
    }
  }
  const t = /\/rest\/v1\/(\w+)/.exec(p);
  if (!t) return {};
  if (method !== 'GET') return single ? {} : [];
  switch (t[1]) {
    case 'profiles': return { id: ME, email: 'alex@example.com', name: 'Alex Rivera', approved: true, blocked: false, is_admin: false, lumora: true, studio: true };
    case 'planner_plans': return single ? planRow : [];
    case 'planner_cues': return cues;
    case 'planner_messages': return messages;
    case 'planner_live': return single ? null : [];
    default: return single ? null : [];
  }
}

async function ctxFor(browser, phone, dark, s = {}) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', colorScheme: dark ? 'dark' : 'light' }
      : s.tablet ? { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', colorScheme: 'light' } : { viewport: { width: s.compact ? 900 : 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: dark ? 'dark' : 'light' },
  );
  await ctx.addInitScript(([s]) => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('lumora.planner', JSON.stringify(s));
        localStorage.setItem('lumora.planner.installCard', 'closed');
        sessionStorage.setItem('seeded', '1');
      }
    } catch {}
  }, [session]);
  await ctx.route(/supabase\.co/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    let body = rest(req.url(), req.method(), req.headers()['accept']);
    if (s.empty && req.url().includes('planner_messages')) body = [];
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  return ctx;
}

const shots = [
  { name: 'plans-desktop', hash: '#/' },
  { name: 'calendar-month-desktop', hash: '#/calendar' },
  { name: 'calendar-week-desktop', hash: '#/calendar', click: 'Week' },
  { name: 'calendar-day-desktop', hash: '#/calendar', click: 'Day' },
  { name: 'calendar-agenda-desktop', hash: '#/calendar', click: 'Agenda' },
  { name: 'calendar-month-dark', hash: '#/calendar', dark: true },
  { name: 'plan-desktop', hash: `#/plan/${PLAN}` },
  { name: 'chat-desktop', hash: `#/plan/${PLAN}/chat` },
  { name: 'chat-dark', hash: `#/plan/${PLAN}/chat`, dark: true },
  { name: 'plans-phone', hash: '#/', phone: true },
  { name: 'calendar-phone', hash: '#/calendar', phone: true },
  { name: 'plan-phone', hash: `#/plan/${PLAN}`, phone: true },
  { name: 'chat-phone', hash: `#/plan/${PLAN}/chat`, phone: true },
  { name: 'chat-phone-dark', hash: `#/plan/${PLAN}/chat`, phone: true, dark: true },
  { name: 'chatx-scrolled-phone', hash: `#/plan/${PLAN}/chat`, phone: true, eval: "document.querySelector('.chat__scroll').scrollTop = 0" },
  { name: 'chatx-mention-desktop', hash: `#/plan/${PLAN}/chat`, type: '@J' },
  { name: 'chatx-picked-phone', hash: `#/plan/${PLAN}/chat`, phone: true, tap: 'Doors in ten minutes.' },
  { name: 'chatx-long-phone', hash: `#/plan/${PLAN}/chat`, phone: true, type: 'Line one|Line two|Line three|Line four' },
  { name: 'schedule-desktop', hash: `#/plan/${PLAN}/schedule` },
  { name: 'crew-desktop', hash: `#/plan/${PLAN}/crew` },
  { name: 'tasks-desktop', hash: `#/plan/${PLAN}/tasks` },
  { name: 'files-desktop', hash: `#/plan/${PLAN}/files` },
  { name: 'newplan-desktop', hash: '#/', eval: "document.querySelector('.page__new button[type=button]').click()", probe: "document.querySelectorAll('.dialog').length + ' ' + document.activeElement.outerHTML.slice(0, 160)" },
  { name: 'share-desktop', hash: `#/plan/${PLAN}`, click: 'Share…' },
  { name: 'account-phone', hash: '#/account', phone: true, probe: "(() => { const p = document.querySelector('.page__foot'); const out=[]; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) { const walk=(r)=>{ if (r.cssRules && !r.selectorText) { for (const x of r.cssRules) walk(x); return; } if (r.selectorText && p.matches(r.selectorText) && /margin/.test(r.style.cssText)) out.push(r.selectorText+' => '+r.style.cssText); }; walk(r); } } catch(e){} } return out; })()" },
  { name: 'schedule-phone', hash: `#/plan/${PLAN}/schedule`, phone: true },
  { name: 'empty-chat-desktop', hash: `#/plan/${PLAN}/chat`, empty: true },
  { name: 'compact-calendar', hash: '#/calendar', compact: true },
  { name: 'calendar-phone-dark', hash: '#/calendar', phone: true, dark: true },
  { name: 'calendar-week-dark', hash: '#/calendar', click: 'Week', dark: true },
  { name: 'tablet-calendar', hash: '#/calendar', tablet: true },
];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const s of shots) {
    if (ONLY.length && !ONLY.some((o) => s.name.includes(o))) continue;
    const ctx = await ctxFor(browser, !!s.phone, !!s.dark, s);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/websocket|realtime|ERR_|Failed to load/i.test(m.text()) && errs.push(m.text()));
    await page.goto(BASE + s.hash);
    await page.waitForTimeout(1800);
    if (s.click) {
      await page.getByRole('button', { name: s.click, exact: !s.loose }).first().click({ timeout: 3000 }).catch(() => console.log('no', s.click));
      await page.waitForTimeout(1500);
    }
    if (s.eval) {
      await page.evaluate(s.eval);
      await page.waitForTimeout(1500);
    }
    if (s.type) {
      const box = page.getByRole('textbox', { name: 'Message' });
      await box.click();
      s.type.split('|').forEach(() => {});
      const parts = s.type.split('|');
      for (let i = 0; i < parts.length; i++) {
        if (i) await page.keyboard.press('Shift+Enter');
        await page.keyboard.type(parts[i]);
      }
      await page.waitForTimeout(300);
    }
    if (s.tap) {
      await page.getByText(s.tap).click();
      await page.waitForTimeout(300);
    }
    if (s.probe) console.log(s.name, JSON.stringify(await page.evaluate(s.probe)));
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (errs.length) console.log(s.name, 'errors:', errs.slice(0, 3).join(' | '));
    else console.log(s.name, 'ok');
    await ctx.close();
  }
  await browser.close();
})();
