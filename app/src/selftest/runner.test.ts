import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScenario, SELFTEST_MARK, TimeoutError, withTimeout, type Step } from './runner';
import { resetSelfTestForTests, startSelfTest, type Invoke, type Scenario } from './start';
import { click, closeDialogs, findByText, waitFor } from './dom';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('the self-test runner', () => {
  it('records each step: passed, or failed with the reason, and how long it took', async () => {
    const order: string[] = [];
    const steps: Step[] = [
      { name: 'one', run: () => void order.push('one') },
      {
        name: 'two',
        run: () => {
          order.push('two');
          throw new Error('the button was missing');
        },
      },
      {
        name: 'three',
        run: async ({ log }) => {
          order.push('three');
          log('a note');
          await sleep(5);
        },
      },
      { name: 'four', run: () => Promise.reject('plain words') },
    ];
    const r = await runScenario('Lumora', steps, { timeoutMs: 5000 });
    expect(order).toEqual(['one', 'two', 'three']);
    expect(r.mark).toBe(SELFTEST_MARK);
    expect(r.product).toBe('Lumora');
    expect(r.ok).toBe(false);
    expect(r.passed).toBe(2);
    expect(r.failed).toBe(2);
    expect(r.steps.map((s) => [s.name, s.ok])).toEqual([
      ['one', true],
      ['two', false],
      ['three', true],
      ['four', false],
    ]);
    expect(r.steps[1]?.message).toBe('the button was missing');
    expect(r.steps[3]?.message).toBe('plain words');
    expect(r.steps[2]?.ms).toBeGreaterThanOrEqual(0);
    expect(r.log.some((l) => l.includes('a note'))).toBe(true);
    expect(r.log.some((l) => l.includes('FAIL two: the button was missing'))).toBe(true);
    expect(() => new Date(r.startedAt).toISOString()).not.toThrow();
    // The results go to a file as JSON.
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('passes only when every step passed (and there was one)', async () => {
    expect((await runScenario('x', [{ name: 'a', run: () => {} }], { timeoutMs: 1000 })).ok).toBe(true);
    expect((await runScenario('x', [], { timeoutMs: 1000 })).ok).toBe(false);
  });

  it('fails a step that runs too long and carries on', async () => {
    const r = await runScenario(
      'x',
      [
        { name: 'hangs', run: () => new Promise<void>(() => {}), timeoutMs: 30 },
        { name: 'next', run: () => {} },
      ],
      { timeoutMs: 5000 },
    );
    expect(r.steps[0]).toMatchObject({ name: 'hangs', ok: false });
    expect(r.steps[0]?.message).toMatch(/Timed out after/);
    expect(r.steps[1]).toMatchObject({ name: 'next', ok: true });
  });

  it('stops at the scenario limit: the rest are failed as not run', async () => {
    const r = await runScenario(
      'x',
      [
        { name: 'slow', run: () => sleep(1000) },
        { name: 'never', run: () => {} },
      ],
      { timeoutMs: 40, stepTimeoutMs: 10_000 },
    );
    expect(r.steps[0]).toMatchObject({ name: 'slow', ok: false });
    expect(r.steps[1]).toMatchObject({ name: 'never', ok: false, skipped: true });
    expect(r.ms).toBeLessThan(900);
  });

  it('withTimeout', async () => {
    await expect(withTimeout(Promise.resolve(3), 50, 'late')).resolves.toBe(3);
    await expect(withTimeout(new Promise(() => {}), 10, 'late')).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('starting the self-test', () => {
  beforeEach(() => resetSelfTestForTests());
  afterEach(() => vi.restoreAllMocks());

  const scenario = (steps: Step[]): Scenario => ({ product: 'Lumora', window: 'control', timeoutMs: 2000, steps: () => steps });

  function fakeInvoke(config: unknown) {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      if (cmd === 'selftest_config') return config;
      return null;
    }) as Invoke;
    return { invoke, calls };
  }

  it('does nothing in a normal run', async () => {
    const { invoke, calls } = fakeInvoke(null);
    const run = vi.fn();
    expect(await startSelfTest(scenario([{ name: 'a', run }]), { invoke, windowLabel: () => 'control' })).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(calls.map((c) => c[0])).toEqual(['selftest_config']);
  });

  it('does nothing in another window (an output screen)', async () => {
    const { invoke, calls } = fakeInvoke({ results: 'r.json', media: null });
    expect(await startSelfTest(scenario([]), { invoke, windowLabel: () => 'output-live' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('runs once, hands in the results and asks to close', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { invoke, calls } = fakeInvoke({ results: 'r.json', media: null });
    const deps = { invoke, windowLabel: () => 'control' };
    const r = await startSelfTest(scenario([{ name: 'a', run: () => {} }]), deps);
    expect(r?.ok).toBe(true);
    const finish = calls.find((c) => c[0] === 'selftest_finish');
    expect(finish?.[1]?.code).toBe(0);
    expect(JSON.parse(String(finish?.[1]?.results))).toMatchObject({ product: 'Lumora', ok: true, steps: [{ name: 'a', ok: true }] });
    expect(await startSelfTest(scenario([]), deps)).toBeNull();
  });

  it('closes with a failure code when a step failed', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { invoke, calls } = fakeInvoke({ results: 'r.json', media: null });
    await startSelfTest(scenario([{ name: 'a', run: () => Promise.reject(new Error('no')) }]), { invoke, windowLabel: () => 'control' });
    expect(calls.find((c) => c[0] === 'selftest_finish')?.[1]?.code).toBe(1);
  });
});

describe('the self-test in the page', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds buttons by their words, clicks them and waits', async () => {
    document.body.innerHTML = '<button class="b">Add input…</button><button class="b">Add a preset…</button>';
    // jsdom lays nothing out: count every element as visible.
    for (const el of document.querySelectorAll('*')) el.getClientRects = () => [{}] as unknown as DOMRectList;
    expect(findByText('.b', 'Add a')?.textContent).toBe('Add a preset…');
    expect(findByText('.b', 'Remove')).toBeNull();
    const clicked = vi.fn();
    document.querySelector('.b')?.addEventListener('click', clicked);
    await click('.b', 'Add input');
    expect(clicked).toHaveBeenCalled();
    await expect(waitFor(() => false, { timeout: 30, interval: 5, message: 'never' })).rejects.toThrow('never');
  });

  it('closes dialogs with Escape, or with their Close button', async () => {
    document.body.innerHTML = '<div role="dialog"><button aria-label="Close">x</button></div>';
    const dialog = document.querySelector('[role="dialog"]')!;
    dialog.getClientRects = () => [{}] as unknown as DOMRectList;
    const close = dialog.querySelector('button')!;
    close.getClientRects = () => [{}] as unknown as DOMRectList;
    close.addEventListener('click', () => dialog.remove());
    await closeDialogs();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
