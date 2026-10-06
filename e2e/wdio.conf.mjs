// WebdriverIO, driving the real program through tauri-driver (the official
// Tauri WebDriver approach; on Windows it hands over to msedgedriver, which
// must match the WebView2 version: see setup-msedgedriver.ps1).
//
// One program per run, chosen by the environment:
//   E2E_APP        the .exe to start
//   E2E_SPEC       the spec file (specs/*.e2e.mjs)
//   E2E_NAME       a short name for results (screenshots, JUnit)
//   E2E_OUT        where results go (default ./results)
//   MSEDGEDRIVER   msedgedriver.exe (default: on PATH)
//   TAURI_DRIVER   tauri-driver.exe (default: ~/.cargo/bin)
//   FFMPEG         ffmpeg.exe, to check the files made

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const name = process.env.E2E_NAME ?? 'e2e';
const out = resolve(process.env.E2E_OUT ?? 'results');
let driver = null;

const portOpen = (port) =>
  new Promise((ok) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => (s.end(), ok(true)));
    s.once('error', () => ok(false));
  });

export const config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: 4444,
  specs: [process.env.E2E_SPEC ?? './specs/*.e2e.mjs'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      // tauri-driver speaks classic WebDriver only (no BiDi).
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': { application: process.env.E2E_APP },
    },
  ],
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 180_000,
  connectionRetryCount: 2,
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 300_000 },
  reporters: ['spec', ['junit', { outputDir: out, outputFileFormat: () => `${name}-junit.xml` }]],

  onPrepare() {
    mkdirSync(out, { recursive: true });
  },

  // tauri-driver starts for the session and stops after it (and the program with it).
  async beforeSession() {
    const exe = process.env.TAURI_DRIVER ?? join(homedir(), '.cargo', 'bin', 'tauri-driver');
    const args = process.env.MSEDGEDRIVER ? ['--native-driver', process.env.MSEDGEDRIVER] : [];
    driver = spawn(exe, args, { stdio: [null, process.stdout, process.stderr] });
    for (let i = 0; i < 60 && !(await portOpen(4444)); i++) await new Promise((r) => setTimeout(r, 500));
  },

  afterSession() {
    driver?.kill();
    driver = null;
  },

  // A picture of every failed step.
  async afterTest(test, _context, { passed }) {
    if (passed) return;
    const file = `${name}-FAILED-${test.title.replace(/[^\w]+/g, '-').slice(0, 60)}.png`;
    await browser.saveScreenshot(join(out, file)).catch(() => {});
  },
};
