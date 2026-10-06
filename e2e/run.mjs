// Runs every end-to-end check, one program at a time, and writes a summary
// (on GitHub Actions: the job's summary page). Exits 1 if any failed.
//
// The programs (a missing one is reported as not run):
//   LUMORA_INSTALLED, STUDIO_INSTALLED   installed from the CI installers
//   LUMORA_TEST, STUDIO_TEST             the test builds (VITE_LUMORA_E2E=1)

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.env.E2E_OUT ?? join(here, 'results'));

const runs = [
  {
    name: 'lumora-installed',
    title: 'Lumora (installer): starts and keeps running',
    smoke: true,
    app: process.env.LUMORA_INSTALLED,
    product: 'Lumora',
  },
  {
    name: 'studio-installed',
    title: 'Lumora Studio (installer): starts and keeps running',
    smoke: true,
    app: process.env.STUDIO_INSTALLED,
    product: 'Lumora Studio',
  },
  {
    name: 'lumora',
    title: 'Lumora: inputs, TAKE, dialogs, rehearsal recording',
    spec: 'specs/lumora.e2e.mjs',
    app: process.env.LUMORA_TEST,
    product: 'Lumora',
  },
  {
    name: 'studio',
    title: 'Lumora Studio: demo, play, cut, undo, Color page, export',
    spec: 'specs/studio.e2e.mjs',
    app: process.env.STUDIO_TEST,
    product: 'Lumora Studio',
  },
];

/** Stops whatever a run left behind (the program, the drivers). */
function tidy(app) {
  if (process.platform !== 'win32') return;
  for (const exe of [app && basename(app), 'msedgedriver.exe', 'tauri-driver.exe']) {
    if (exe) spawnSync('taskkill', ['/F', '/T', '/IM', exe], { stdio: 'ignore' });
  }
}

function junitCounts(name) {
  try {
    const xml = readFileSync(join(out, `${name}-junit.xml`), 'utf8');
    const n = (attr) => [...xml.matchAll(new RegExp(`<testsuite [^>]*${attr}="(\\d+)"`, 'g'))].reduce((s, m) => s + Number(m[1]), 0);
    const failures = [...xml.matchAll(/<testcase [^>]*name="([^"]+)"[^>]*>\s*<failure/g)].map((m) => m[1]);
    return { tests: n('tests'), failed: n('failures') + n('errors'), failures };
  } catch {
    return null;
  }
}

/**
 * The installed programs can't be driven (their WebView settings shut out the
 * test driver, as they should): they must start and still be running after 20 s.
 */
function startsAndRuns(app) {
  if (process.platform !== 'win32') return { ok: false, detail: 'Windows only' };
  const child = spawn(app, [], { detached: true, stdio: 'ignore' });
  child.unref();
  const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  wait(20_000);
  const list = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${basename(app)}`, '/NH'], { encoding: 'utf8' });
  const running = (list.stdout ?? '').toLowerCase().includes(basename(app).toLowerCase());
  return { ok: running, detail: running ? 'running after 20 s' : 'not running after 20 s (closed or crashed)' };
}

const rows = [];
let failed = false;
for (const r of runs) {
  if (!r.app || !existsSync(r.app)) {
    rows.push(`| ${r.title} | ⚪ not run (no program at \`${r.app ?? 'unset'}\`) | |`);
    failed = true;
    continue;
  }
  console.log(`\n=== ${r.title} (${r.app}) ===`);
  tidy(r.app);
  if (r.smoke) {
    const res = startsAndRuns(r.app);
    tidy(r.app);
    failed ||= !res.ok;
    rows.push(`| ${r.title} | ${res.ok ? '✅ passed' : '❌ failed'} | ${res.detail} |`);
    continue;
  }
  const res = spawnSync('npx', ['wdio', 'run', 'wdio.conf.mjs'], {
    cwd: here,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    timeout: 25 * 60_000,
    env: { ...process.env, E2E_APP: r.app, E2E_SPEC: `./${r.spec}`, E2E_NAME: r.name, E2E_OUT: out, E2E_PRODUCT: r.product },
  });
  tidy(r.app);
  const ok = res.status === 0;
  failed ||= !ok;
  const c = junitCounts(r.name);
  const detail = c ? `${c.tests - c.failed}/${c.tests} steps passed${c.failures.length ? `; failed: ${c.failures.join('; ')}` : ''}` : '';
  rows.push(`| ${r.title} | ${ok ? '✅ passed' : '❌ failed'} | ${detail} |`);
}

const pictures = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.png')).length : 0;
const summary = [
  '## End-to-end smoke tests (Windows)',
  '',
  '| Check | Result | Steps |',
  '| --- | --- | --- |',
  ...rows,
  '',
  `${pictures} screenshots are in the **e2e-results** artifact. These checks do not block releases yet.`,
  '',
].join('\n');
console.log(`\n${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(failed ? 1 : 0);
