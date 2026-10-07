import { describe, expect, it } from 'vitest';
import { InputHealth } from './inputHealth';
import { EngineHealthWatch, unifiedBlocksTestEvent, unifiedOn } from './unified';

function setup() {
  let now = 0;
  const health = new InputHealth(() => now);
  const watch = new EngineHealthWatch(health);
  const at = (t: number) => {
    now = t;
    health.beat();
  };
  return { health, watch, at };
}

describe('the unified engine feeds the backup lineup', () => {
  it('counts an input with frames arriving as having a picture', () => {
    const { health, watch, at } = setup();
    watch.update([{ id: 'cam', state: 'live', detail: null, frames: 10 }]);
    at(1000);
    watch.update([{ id: 'cam', state: 'live', detail: null, frames: 70 }]);
    expect(health.down('cam', 1500)).toBeNull();
  });

  it('notices frames that stop coming', () => {
    const { health, watch, at } = setup();
    watch.update([{ id: 'cam', state: 'live', detail: null, frames: 10 }]);
    at(1000);
    watch.update([{ id: 'cam', state: 'live', detail: null, frames: 10 }]);
    at(3000);
    watch.update([{ id: 'cam', state: 'live', detail: null, frames: 10 }]);
    expect(health.down('cam', 1500)).toBe('No picture coming in');
  });

  it('passes on why an input failed, and clears it when it is back', () => {
    const { health, watch, at } = setup();
    watch.update([{ id: 'cam', state: 'failed', detail: 'Camera “BRIO” not found or unplugged', frames: 0 }]);
    expect(health.down('cam', 1500)).toBe('Camera “BRIO” not found or unplugged');
    at(500);
    watch.update([{ id: 'cam', state: 'live', detail: null, frames: 5 }]);
    expect(health.down('cam', 1500)).toBeNull();
  });

  it('gives a camera that is still opening its usual grace time', () => {
    const { health, watch, at } = setup();
    watch.update([{ id: 'cam', state: 'starting', detail: null, frames: 0 }]);
    at(3000);
    watch.update([{ id: 'cam', state: 'starting', detail: null, frames: 0 }]);
    expect(health.down('cam', 1500)).toBeNull();
  });

  it('stops watching inputs the engine no longer has', () => {
    const { health, watch } = setup();
    watch.update([{ id: 'cam', state: 'noSignal', detail: null, frames: 3 }]);
    expect(health.down('cam', 1500)).toBe('No picture coming in');
    watch.stop();
    expect(health.down('cam', 1500)).toBeNull();
  });
});

describe('outside the Lumora app', () => {
  it('is always the Standard engine', () => {
    expect(unifiedOn()).toBe(false);
    expect(unifiedBlocksTestEvent()).toBeNull();
  });
});
