// Runs every end-to-end check, one program at a time, and writes a summary
// (on GitHub Actions: the job's summary page). Exits 1 if any failed.
//
// The programs (a missing one is reported as not run):
//   LUMORA_INSTALLED, STUDIO_INSTALLED   installed from the CI installers: they
//                                        must start and keep running.
//   LUMORA_TEST, STUDIO_TEST             the test builds (VITE_LUMORA_E2E=1): each
//                                        runs its own self-test in the page
//                                        (app/src/selftest/), writes the results
//                                        to LUMORA_SELFTEST and closes.
// Also read: E2E_MEDIA (Lumora Studio's demo media, e2e/make-media.mjs), FFMPEG,
// E2E_OUT (where the results go, default e2e/results), E2E_MINUTES (the limit
// for each self-test, default 20).

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.env.E2E_OUT ?? join(here, 'results'));
const minutes = Number(process.env.E2E_MINUTES) > 0 ? Number(process.env.E2E_MINUTES) : 20;
mkdirSync(out, { recursive: true });

const runs = [
  {
    name: 'lumora-installed',
    title: 'Lumora (installer): starts and keeps running',
    smoke: true,
    app: process.env.LUMORA_INSTALLED,
  },
  {
    name: 'studio-installed',
    title: 'Lumora Studio (installer): starts and keeps running',
    smoke: true,
    app: process.env.STUDIO_INSTALLED,
  },
  {
    name: 'lumora',
    title: 'Lumora: inputs, TAKE, dialogs, rehearsal recording',
    app: process.env.LUMORA_TEST,
  },
  {
    name: 'studio',
    title: 'Lumora Studio: demo, play, cut, undo, Color page, export',
    app: process.env.STUDIO_TEST,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stops a program that is still running (and what it started). */
function tidy(app) {
  if (process.platform !== 'win32' || !app) return;
  spawnSync('taskkill', ['/F', '/T', '/IM', basename(app)], { stdio: 'ignore' });
}

function running(app) {
  if (process.platform !== 'win32') return false;
  const list = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${basename(app)}`, '/NH'], { encoding: 'utf8' });
  return (list.stdout ?? '').toLowerCase().includes(basename(app).toLowerCase());
}

/**
 * The installed programs: they must start and still be running after 20 s.
 * They are started with LUMORA_SELFTEST set too, and must ignore it (the
 * shipped screens have no self-test), so no results file may appear.
 */
async function startsAndRuns(r) {
  if (process.platform !== 'win32') return { ok: false, detail: 'Windows only' };
  const results = join(out, `${r.name}-must-not-exist.json`);
  rmSync(results, { force: true });
  const child = spawn(r.app, [], { detached: true, stdio: 'ignore', env: { ...process.env, LUMORA_SELFTEST: results } });
  child.unref();
  await sleep(20_000);
  const alive = running(r.app);
  const selfTested = existsSync(results);
  const ok = alive && !selfTested;
  const detail = !alive
    ? 'not running after 20 s (closed or crashed)'
    : selfTested
      ? 'the installed program ran the self-test (it must not have one)'
      : 'running after 20 s; no self-test in it';
  return { ok, detail };
}

/** Runs a test build's self-test: start it with LUMORA_SELFTEST and wait for it to close. */
async function selfTest(r) {
  const results = join(out, `${r.name}-results.json`);
  rmSync(results, { force: true });
  const output = openSync(join(out, `${r.name}-output.log`), 'w');
  const limit = minutes * 60_000;
  const began = Date.now();
  const child = spawn(r.app, [], {
    stdio: ['ignore', output, output],
    env: {
      ...process.env,
      LUMORA_SELFTEST: results,
      // The program closes by itself a little before this script gives up on it.
      LUMORA_SELFTEST_TIMEOUT: String(Math.max(60, Math.round(limit / 1000) - 60)),
    },
  });
  const exit = await new Promise((done) => {
    const timer = setTimeout(() => done({ code: null, why: `still running after ${minutes} min (stopped)` }), limit);
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ code: null, why: `could not start: ${e.message}` });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      done({ code, why: `closed with code ${code}` });
    });
  });
  tidy(r.app);
  const seconds = Math.round((Date.now() - began) / 1000);
  let data = null;
  try {
    data = JSON.parse(readFileSync(results, 'utf8'));
  } catch {
    // No results: reported below.
  }
  return { data, exit, seconds };
}

const cell = (s) =>
  String(s ?? '')
    .replace(/\r?\n+/g, ' ⏎ ')
    .replace(/\|/g, '\\|')
    .slice(0, 400);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

const rows = [];
let failed = false;
for (const r of runs) {
  if (!r.app || !existsSync(r.app)) {
    rows.push(`| ${r.title} | ⚪ not run | no program at \`${r.app ?? 'unset'}\` |`);
    failed = true;
    continue;
  }
  console.log(`\n=== ${r.title} (${r.app}) ===`);
  tidy(r.app);
  if (r.smoke) {
    const res = await startsAndRuns(r);
    tidy(r.app);
    failed ||= !res.ok;
    rows.push(`| ${r.title} | ${res.ok ? '✅ passed' : '❌ failed'} | ${res.detail} |`);
    continue;
  }
  const { data, exit, seconds } = await selfTest(r);
  if (!data) {
    failed = true;
    rows.push(`| ${r.title} | ❌ failed | no results: the program ${exit.why} after ${seconds} s |`);
    continue;
  }
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const passed = steps.filter((s) => s.ok).length;
  const ok = data.ok === true && steps.length > 0 && passed === steps.length;
  failed ||= !ok;
  const note = data.error ? `; ${cell(data.error)}` : '';
  rows.push(`| **${r.title}** | ${ok ? '✅ passed' : '❌ failed'} | ${passed}/${steps.length} steps passed in ${seconds} s${note} |`);
  for (const s of steps) {
    const result = s.ok ? '✅ passed' : s.skipped ? '⚪ not run' : '❌ failed';
    rows.push(`| ↳ ${cell(s.name)} | ${result} | ${secs(s.ms ?? 0)}${s.message ? `: ${cell(s.message)}` : ''} |`);
  }
  for (const s of steps) console.log(`${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.message ? `: ${s.message}` : ''}`);
  if (Array.isArray(data.log)) writeFileSync(join(out, `${r.name}-log.txt`), data.log.join('\n'));
}

const summary = [
  '## End-to-end smoke tests (Windows)',
  '',
  '| Check | Result | Details |',
  '| --- | --- | --- |',
  ...rows,
  '',
  'Each test build ran its own self-test; the results (JSON) and logs are in the **e2e-results** artifact. These checks do not block releases yet.',
  '',
].join('\n');
console.log(`\n${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(failed ? 1 : 0);
