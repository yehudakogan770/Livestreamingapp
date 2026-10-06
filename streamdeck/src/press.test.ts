// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BOUNCE_MS, Gesture } from './press';
import { FakeTimers } from './testing';

function key(holdMs = 0, doubleMs = 0) {
  const timers = new FakeTimers();
  const log: string[] = [];
  const g = new Gesture(
    {
      press: () => log.push('press'),
      double: () => log.push('double'),
      held: () => log.push('held'),
      cancelled: () => log.push('cancelled'),
      progress: (p) => p !== null && p > 0 && log.push(`hold ${p.toFixed(1)}`),
    },
    { holdMs: () => holdMs, doubleMs, timers },
  );
  return { g, timers, log };
}

describe('key presses', () => {
  it('a key held down (and repeating) is one press', () => {
    const { g, timers, log } = key();
    g.keyDown();
    for (let i = 0; i < 10; i++) {
      timers.advance(100);
      g.keyDown();
    }
    g.keyUp();
    expect(log).toEqual(['press']);
  });

  it('a bouncing contact is one press; two real presses are two', () => {
    const { g, timers, log } = key();
    g.keyDown();
    g.keyUp();
    timers.advance(BOUNCE_MS - 20);
    g.keyDown();
    g.keyUp();
    expect(log).toEqual(['press']);
    timers.advance(300);
    g.keyDown();
    g.keyUp();
    expect(log).toEqual(['press', 'press']);
  });

  it('a key up without a key down does nothing', () => {
    const { g, log } = key();
    g.keyUp();
    expect(log).toEqual([]);
  });
});

describe('hold to confirm', () => {
  it('fires once held long enough, showing the progress', () => {
    const { g, timers, log } = key(1000);
    g.keyDown();
    timers.advance(500);
    expect(log).not.toContain('held');
    timers.advance(600);
    expect(log.filter((l) => l === 'held')).toHaveLength(1);
    expect(log).toContain('hold 0.5');
    g.keyUp();
    expect(log).not.toContain('cancelled');
  });

  it('letting go early cancels', () => {
    const { g, timers, log } = key(1000);
    g.keyDown();
    timers.advance(400);
    g.keyUp();
    timers.advance(2000);
    expect(log).not.toContain('held');
    expect(log).toContain('cancelled');
    expect(timers.count).toBe(0);
  });

  it('a key that went away forgets its hold', () => {
    const { g, timers, log } = key(1000);
    g.keyDown();
    g.reset();
    timers.advance(2000);
    expect(log).not.toContain('held');
  });
});

describe('double press', () => {
  it('press, then press again soon: the second is a double press', () => {
    const { g, timers, log } = key(0, 400);
    g.keyDown();
    g.keyUp();
    timers.advance(200);
    g.keyDown();
    g.keyUp();
    expect(log).toEqual(['press', 'double']);
    // A third press starts over.
    timers.advance(200);
    g.keyDown();
    g.keyUp();
    expect(log).toEqual(['press', 'double', 'press']);
  });

  it('too far apart: two presses', () => {
    const { g, timers, log } = key(0, 400);
    g.keyDown();
    g.keyUp();
    timers.advance(600);
    g.keyDown();
    g.keyUp();
    expect(log).toEqual(['press', 'press']);
  });
});
