import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DemoClient, emptyShow } from '../engine/client';
import { demoApply } from '../engine/demo';
import { SoundEngine } from './soundEngine';

// A pretend Web Audio: every node accepts connections, every setting is kept.
function thing(): unknown {
  const t: Record<string | symbol, unknown> = {};
  return new Proxy(
    Object.assign(() => {}, t),
    {
      get: (o, k) => (k in o ? (o as unknown as Record<string | symbol, unknown>)[k] : ((o as unknown as Record<string | symbol, unknown>)[k] = thing())),
    },
  );
}
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = thing();
  resume = () => Promise.resolve();
  close = () => Promise.resolve();
  constructor() {
    return new Proxy(this, { get: (o, k) => (k in o ? (o as unknown as Record<string | symbol, unknown>)[k] : () => thing()) });
  }
}

class Track extends EventTarget {
  stop = vi.fn();
  unplug() {
    this.dispatchEvent(new Event('ended'));
  }
}

let tracks: Track[];
let refuse = false;
beforeEach(() => {
  vi.useFakeTimers();
  tracks = [];
  refuse = false;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => {
        if (refuse) return Promise.reject(new DOMException('gone', 'NotFoundError'));
        const t = new Track();
        tracks.push(t);
        return Promise.resolve({ getTracks: () => [t], getAudioTracks: () => [t] });
      }),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

test('a microphone that drops out comes back by itself', async () => {
  const show = demoApply(emptyShow(), { type: 'addSource', source: { id: 'mic', name: 'Mic', kind: { type: 'microphone', deviceId: 'm', label: 'Mic' } } }, 0);
  const sound = new SoundEngine(new DemoClient());
  sound.setShow(show);
  await vi.advanceTimersByTimeAsync(100);
  expect(tracks).toHaveLength(1);
  // A USB hiccup: gone, and not back straight away.
  refuse = true;
  tracks[0]!.unplug();
  expect(sound.problems.has('mic')).toBe(true);
  await vi.advanceTimersByTimeAsync(7000);
  expect(sound.problems.has('mic')).toBe(true);
  // Plugged back in: heard again within a few seconds, with nobody touching anything.
  refuse = false;
  await vi.advanceTimersByTimeAsync(4000);
  expect(tracks).toHaveLength(2);
  expect(sound.problems.has('mic')).toBe(false);
  sound.dispose();
});
