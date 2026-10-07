// Profiles Lumora's control window in Chromium with a show running: four
// cameras (two on the monitors, two as input tiles), a lower third on air,
// five microphones in the mixer, and (unless NOREC=1) recording on.
// Prints startup, main-thread time per frame, long tasks, React renders and
// the JS heap after TOTAL seconds. See docs/PERFORMANCE.md.
//
//   node scripts/perf/measure.cjs <label> [windowSec=60] [totalSec=180] [port=1431]
//   env: NOREC=1 (no recording) · PROFILE=1 (10 s CPU profile, hottest functions)
//        CHROME=<chromium binary> · PLAYWRIGHT=<playwright module> · PERF_MEDIA=<dir>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const LABEL = process.argv[2] || 'run';
const WIN = Number(process.argv[3] || 60);
const TOTAL = Number(process.argv[4] || 180);
const PORT = Number(process.argv[5] || 1431);
const NOREC = !!process.env.NOREC;
const MEDIA = process.env.PERF_MEDIA || path.join(os.tmpdir(), 'lumora-perf-media');

/** Four 20 s, 1280×720, 30 fps test pictures (the cameras), made once with ffmpeg. */
function makeMedia() {
  fs.mkdirSync(MEDIA, { recursive: true });
  for (let i = 1; i <= 4; i++) {
    const f = path.join(MEDIA, `cam${i}.webm`);
    if (fs.existsSync(f)) continue;
    const r = spawnSync(process.env.FFMPEG || 'ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20', '-vf', `hue=h=${i * 80}`],
      ...['-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', f],
    ]);
    if (r.status !== 0) throw new Error(`ffmpeg could not make ${f}: ${r.stderr}`);
  }
}

// In the page, before Lumora: long tasks, frames, and (while counting) which components rendered.
const PAGE_HOOKS = () => {
  window.__long = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  window.__frames = 0;
  requestAnimationFrame(function tick() {
    window.__frames++;
    requestAnimationFrame(tick);
  });
  window.__census = null;
  const nameOf = (f) => {
    let t = f.type;
    if (f.tag === 14 || f.tag === 15) t = t.type || t;
    if (f.tag === 11) t = t.render || t;
    return (t && (t.displayName || t.name)) || 'anonymous';
  };
  const isComp = (f) => f.tag === 0 || f.tag === 1 || f.tag === 11 || f.tag === 14 || f.tag === 15;
  // Only the parts of the tree this commit touched, as React DevTools does
  // (a fiber whose children are the same objects as before bailed out).
  // "ROOT x": x rendered while its parent did not (its own state changed).
  const walk = (next, out, parentRendered) => {
    const prev = next.alternate;
    let r = parentRendered;
    if (isComp(next)) {
      r = !!(next.flags & 1) || !prev;
      if (r) {
        const n = nameOf(next);
        out[n] = (out[n] || 0) + 1;
        if (!parentRendered && prev) out[`ROOT ${n}`] = (out[`ROOT ${n}`] || 0) + 1;
      }
    }
    if (prev && next.child === prev.child) return;
    for (let c = next.child; c; c = c.sibling) walk(c, out, r);
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      if (!window.__census) return;
      window.__census.commits = (window.__census.commits || 0) + 1;
      walk(root.current, window.__census, false);
    },
  };
};

(async () => {
  makeMedia();
  const b = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      // No GPU here: canvas drawing runs on the main thread (a weak computer's worst case).
      '--disable-gpu',
      '--enable-precise-memory-info',
    ],
  });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: `http://localhost:${PORT}` });
  await ctx.addInitScript(PAGE_HOOKS);
  await ctx.addInitScript({ path: path.join(__dirname, 'fake-devices.js') });
  const p = await ctx.newPage();
  p.setDefaultTimeout(30000);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

  // ---- startup: until the show is on screen
  await p.goto(`http://localhost:${PORT}/`);
  await p.waitForFunction(() => document.querySelector('.workarea') && !document.querySelector('.workarea > .loading'), null, { polling: 5 });
  const startup = await p.evaluate(() => performance.now());
  const boot = await metrics();
  await p
    .getByText('Skip for now')
    .click({ timeout: 3000 })
    .catch(() => {});
  await p.waitForFunction(() => !!window.__demo, null, { timeout: 15000 });

  // ---- the show
  await p.evaluate(async () => {
    const d = window.__demo;
    const A = (a) => d.dispatch(a).catch((e) => console.warn('refused', a.type, e?.message ?? e));
    await A({ type: 'updateEvent', patch: { name: 'Perf Summit', setUp: true } });
    for (const [id, label] of window.__CAMS) await A({ type: 'addSource', source: { id, name: label, kind: { type: 'camera', deviceId: id, label } } });
    await A({ type: 'addSource', source: { id: 'slides', name: 'Slides', kind: { type: 'color', color: '#203040' } } });
    for (const [id, label] of window.__MICS) await A({ type: 'addSource', source: { id, name: label, kind: { type: 'microphone', deviceId: id, label } } });
    const preset = (id, name, sources) =>
      A({ type: 'addPreset', preset: { id, name, category: '', screen: 'live', sources, transition: null, loadFirst: true, buttons: [] } });
    await preset('p-key', 'Keynote', ['cam-close', 'cam-left', 'slides']);
    await preset('p-panel', 'Panel', ['cam-wide', 'cam-left', 'cam-aud']);
    await A({ type: 'pickPreset', id: 'p-key' });
    await A({ type: 'setPreview', screen: 'back', sourceId: 'slides' });
    await A({ type: 'cutTo', screen: 'back', sourceId: 'slides' });
    await A({ type: 'setPreview', screen: 'live', sourceId: 'cam-close' });
    await A({ type: 'take', screen: 'live', transition: 'cut' });
    await A({ type: 'setPreview', screen: 'live', sourceId: 'cam-wide' });
    // A lower third on air.
    const lt = { type: 'text', ...window.__text.TEXT_TEMPLATES[0].make(), text: 'Marco Reyes', sub: 'Host' };
    await A({ type: 'addSource', source: { id: 'lt', name: 'Marco Reyes', kind: lt } });
    await A({ type: 'setOverlaySource', channel: 1, sourceId: 'lt' });
    await A({ type: 'setOverlayInNext', channel: 1, value: false });
    await A({ type: 'setOverlayOn', channel: 1, value: true });
  });
  await p.waitForTimeout(1500);
  let recording = false;
  if (!NOREC) {
    await p.locator('button[title="Record the Live Screen to a file"]').first().click();
    await p.waitForTimeout(800);
    recording = await p.evaluate(() => /Recording to/.test(document.body.innerHTML));
  }
  const sceneStart = Date.now();
  await p.waitForTimeout(8000);

  // ---- steady state
  const m0 = await metrics();
  const s0 = await p.evaluate(() => ({ f: window.__frames, c: window.__prof?.commits ?? 0, ms: window.__prof?.ms ?? 0, t: performance.now() }));
  await p.waitForTimeout(WIN * 1000);
  const m1 = await metrics();
  const s1 = await p.evaluate(() => ({
    f: window.__frames,
    c: window.__prof?.commits ?? 0,
    ms: window.__prof?.ms ?? 0,
    t: performance.now(),
    long: window.__long,
  }));
  const secs = (s1.t - s0.t) / 1000;
  const frames = s1.f - s0.f;
  const d = (k) => m1[k] - m0[k];
  const long = s1.long.filter(([at]) => at >= s0.t);

  // ---- where the main thread's time goes (10 s CPU profile)
  let hot = null;
  if (process.env.PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await p.waitForTimeout(10000);
    const { profile } = await cdp.send('Profiler.stop');
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = {};
    let total = 0;
    profile.samples.forEach((id, i) => {
      const cf = byId.get(id).callFrame;
      const k = `${cf.functionName || '(anonymous)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
      self[k] = (self[k] || 0) + (profile.timeDeltas[i] || 0);
      total += profile.timeDeltas[i] || 0;
    });
    hot = Object.entries(self)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 30)
      .map(([k, us]) => `${((us / total) * 100).toFixed(1).padStart(5)}% ${k}`);
  }

  // ---- which components render, 10 s
  await p.evaluate(() => (window.__census = {}));
  await p.waitForTimeout(10000);
  const census = await p.evaluate(() => {
    const c = window.__census;
    window.__census = null;
    return Object.entries(c)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 30);
  });

  // ---- memory after TOTAL seconds of show
  const left = TOTAL * 1000 - (Date.now() - sceneStart);
  if (left > 0) await p.waitForTimeout(left);
  await cdp.send('HeapProfiler.collectGarbage');
  const end = await metrics();

  const r = {
    label: LABEL,
    recording,
    startupMs: Math.round(startup),
    bootScriptMs: Math.round(boot.ScriptDuration * 1000),
    fps: +(frames / secs).toFixed(1),
    mainMsPerFrame: +((d('TaskDuration') * 1000) / frames).toFixed(2),
    mainMsPerSecond: +((d('TaskDuration') * 1000) / secs).toFixed(0),
    scriptMsPerSecond: +((d('ScriptDuration') * 1000) / secs).toFixed(0),
    layoutMsPerSecond: +((d('LayoutDuration') * 1000) / secs).toFixed(0),
    longTasksPerMin: +((long.length / secs) * 60).toFixed(1),
    reactCommitsPerSec: +((s1.c - s0.c) / secs).toFixed(1),
    reactRenderMsPerSec: +((s1.ms - s0.ms) / secs).toFixed(1),
    heapMB: +(end.JSHeapUsedSize / 1048576).toFixed(1),
    domNodes: end.Nodes,
    census,
    hot,
    errors: errors.slice(0, 10),
  };
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
