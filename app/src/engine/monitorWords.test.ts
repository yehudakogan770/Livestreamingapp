import { expect, test } from 'vitest';
import { defaultCountdown, emptyShow } from './client';
import { demoApply } from './demo';
import { drawMonitorWords, monitorModel, monitorMoving } from './monitorWords';
import type { Show } from './types/Show';

/** A context that records the words written, and measures 10 px a character. */
function recorder() {
  const words: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (t, k) => {
      if (k === 'fillText') return (text: string) => words.push(text);
      if (k === 'measureText') return (s: string) => ({ width: s.length * 10 });
      return k in t ? t[k as string] : () => {};
    },
    set: (t, k, v) => {
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, words };
}

function show(): Show {
  let s = emptyShow();
  s = demoApply(
    s,
    { type: 'addSource', source: { id: 'cd', name: 'Countdown', kind: { type: 'countdown', background: '#000000', timer: defaultCountdown() } } },
    0,
  );
  s.monitor.message = 'Two minutes';
  s.monitor.messageOn = true;
  s.monitor.showClock = true;
  s.monitor.showTimer = true;
  return s;
}

test('the monitor shows the message, the clock and the countdown, as MonitorScreen', () => {
  const s = show();
  const m = monitorModel(s, 1_000_000);
  expect(m.message).toBe('Two minutes');
  expect(m.clock?.time).toBeTruthy();
  expect(m.timer?.tag).toBe('COUNTDOWN · WAITING');
  expect(m.timer?.paused).toBe(true);
  expect(m.flash).toBe(false);
  expect(m.dark).toBe(0);
  for (const layout of ['full', 'stack', 'split'] as const) {
    s.monitor.layout = layout;
    const { ctx, words } = recorder();
    drawMonitorWords(ctx, 1920, 1080, s, 1_000_000);
    expect(words).toEqual(expect.arrayContaining(['Two minutes', 'TIME', 'COUNTDOWN · WAITING']));
  }
});

test('a long message is made smaller to fit, flashing and PANIC show, the prompter rolls', () => {
  const s = show();
  s.monitor.message = 'word '.repeat(200).trim();
  const { ctx, words } = recorder();
  drawMonitorWords(ctx, 1920, 1080, s, 1_000_000);
  // Wrapped over many lines, none wider than the screen.
  expect(words.filter((w) => w.startsWith('word')).length).toBeGreaterThan(3);
  expect(words.every((w) => w.length * 10 <= 1920)).toBe(true);
  s.screens.monitor.flashAt = 1_000_000;
  expect(monitorModel(s, 1_000_050).flash).toBe(true);
  expect(monitorMoving(s, 1_000_050)).toBe(true);
  s.panic = true;
  s.panicChangedAt = 0;
  expect(monitorModel(s, 1_000_000).dark).toBeCloseTo(0.6);
  s.monitor.prompter = { ...s.monitor.prompter, on: true, script: 'Hello\nWorld', since: 1_000_000, speed: 5 };
  expect(monitorMoving(s, 2_000_000)).toBe(true);
  const r = recorder();
  drawMonitorWords(r.ctx, 1920, 1080, s, 1_000_000);
  expect(r.words).toEqual(expect.arrayContaining(['Hello', 'World', '▶']));
});
