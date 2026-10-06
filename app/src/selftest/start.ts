// The end-to-end self-test (CI test builds only). The screens load this only
// behind `if (TEST_BUILD)`, so the installers people download don't carry it
// (selftest.test.ts checks the built screens). When the program is started
// with LUMORA_SELFTEST=<results file>, it runs its scenario in the page, has
// the Rust side write the results to that file, and closes. e2e/run.mjs reads
// the file and writes the summary.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { describe, runScenario, SELFTEST_MARK, type SelfTestResults, type Step } from './runner';

export interface SelfTestConfig {
  results: string;
  media: string | null;
}

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export interface SelfTestDeps {
  invoke: Invoke;
  /** The window this page is in (only the main window runs the test). */
  windowLabel: () => string;
}

export interface Scenario {
  product: string;
  /** The window that runs it. */
  window: string;
  timeoutMs: number;
  stepTimeoutMs?: number;
  steps: (cfg: SelfTestConfig, invoke: Invoke) => Step[];
}

const defaults: SelfTestDeps = {
  invoke: tauriInvoke as Invoke,
  windowLabel: () => getCurrentWindow().label,
};

let started = false;

/**
 * Runs the scenario if this is a self-test run (and this the main window),
 * hands in the results, and closes the program. Returns the results (null:
 * not a self-test run).
 */
export async function startSelfTest(scenario: Scenario, deps: SelfTestDeps = defaults): Promise<SelfTestResults | null> {
  let cfg: SelfTestConfig | null;
  try {
    if (deps.windowLabel() !== scenario.window) return null;
    cfg = await deps.invoke<SelfTestConfig | null>('selftest_config');
  } catch {
    return null;
  }
  if (!cfg || started) return null;
  started = true;
  let results: SelfTestResults;
  try {
    results = await runScenario(scenario.product, scenario.steps(cfg, deps.invoke), {
      timeoutMs: scenario.timeoutMs,
      ...(scenario.stepTimeoutMs ? { stepTimeoutMs: scenario.stepTimeoutMs } : {}),
      echo: (line) => console.info(`[selftest] ${line}`),
    });
  } catch (e) {
    results = {
      mark: SELFTEST_MARK,
      product: scenario.product,
      ok: false,
      startedAt: new Date().toISOString(),
      ms: 0,
      steps: [],
      passed: 0,
      failed: 0,
      log: [],
      error: describe(e),
    };
  }
  // Writes the file, then the program closes (the Rust side's watchdog closes it if this fails).
  await deps.invoke('selftest_finish', { results: JSON.stringify(results), code: results.ok ? 0 : 1 }).catch((e: unknown) => {
    console.error(`[selftest] could not hand in the results: ${describe(e)}`);
  });
  return results;
}

/** For the tests: as if the program had just started. */
export function resetSelfTestForTests() {
  started = false;
}
