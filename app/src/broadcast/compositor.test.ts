import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DemoClient } from '../engine/client';
import type { Action } from '../engine/types/Action';
import type { Show } from '../engine/types/Show';
import { ProgramCompositor } from './compositor';

// A pretend 2D drawing context: every call is accepted, and save/restore are counted.
let depth: number;
let fills: { style: unknown; alpha: unknown }[];
function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, fillStyle: '#000' };
  const methods: Record<string, (...a: unknown[]) => unknown> = {
    save: () => void depth++,
    restore: () => void (depth = Math.max(0, depth - 1)),
    fillRect: () => void fills.push({ style: state.fillStyle, alpha: state.globalAlpha }),
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  return new Proxy(state, {
    get: (t, k) => (typeof k === 'string' && k in methods ? methods[k] : k in t ? t[k] : () => undefined),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
    defineProperty: (t, k, d) => Reflect.defineProperty(t, k, d),
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  depth = 0;
  fills = [];
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => (type === '2d' ? fakeContext() : null)) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A show with a few inputs of different kinds. */
async function withInputs(client: DemoClient): Promise<string[]> {
  const sources: Action[] = [
    { type: 'addSource', source: { id: 'a', name: 'A', kind: { type: 'color', color: '#ff0000' } } },
    { type: 'addSource', source: { id: 'b', name: 'B', kind: { type: 'pattern' } } },
    { type: 'addSource', source: { id: 'c', name: 'C', kind: { type: 'image', path: 'c.png' } } },
    { type: 'addSource', source: { id: 'v', name: 'V', kind: { type: 'video', path: 'v.mp4', durationS: 10, playback: { playing: false, posS: 0, at: 0 } } } },
  ];
  for (const a of sources) await client.dispatch(a);
  return ['a', 'b', 'c', 'v'];
}

async function onAir(client: DemoClient): Promise<{ show: Show; id: string }> {
  await withInputs(client);
  await client.dispatch({ type: 'cutTo', screen: 'live', sourceId: 'a' });
  return { show: (await client.getShow()).show, id: 'a' };
}

test('an input that fails to draw never takes PANIC or the overlays with it', async () => {
  const client = new DemoClient();
  const { id } = await onAir(client);
  await client.dispatch({ type: 'panic', value: true });
  const show = (await client.getShow()).show;
  const c = new ProgramCompositor(client, 640, 360);
  c.setShow({ ...show, panicChangedAt: 0 });
  const proto = ProgramCompositor.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  vi.spyOn(proto, 'drawSource').mockImplementation((src) => {
    if ((src as { id: string }).id === id) {
      // Fails halfway, with drawing state still changed.
      (c as unknown as { ctx: CanvasRenderingContext2D }).ctx.save();
      throw new Error('broken picture');
    }
  });
  const safe = vi.spyOn(proto, 'safeScreen');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (let i = 0; i < 50; i++) c.draw(10_000 + i * 33);
  expect(safe).toHaveBeenCalledTimes(50);
  expect(safe.mock.calls.every((a) => a[1] === 'panic')).toBe(true);
  expect(console.error).toHaveBeenCalledTimes(1);
  c.dispose();
});

test('hours of frames and switching keep nothing growing', async () => {
  const client = new DemoClient();
  const ids = await withInputs(client);
  const c = new ProgramCompositor(client, 320, 180);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const internals = c as unknown as Record<string, Map<unknown, unknown> | Set<unknown>>;
  const sizes = () => ['media', 'pictures', 'starts', 'keyers', 'visions', 'pages', 'delays'].map((k) => internals[k]?.size ?? 0);
  let peak = [0, 0, 0, 0, 0, 0, 0];
  let now = Date.now();
  // About two hours at 30 frames a second would be 216 000 frames; a cut every 10 s.
  for (let frame = 0; frame < 20_000; frame++) {
    if (frame % 300 === 0) {
      // Alternately a cut and a mix, with an overlay going on and off.
      const next = ids[(frame / 300) % ids.length]!;
      if (frame % 600 === 0) await client.dispatch({ type: 'cutTo', screen: 'live', sourceId: next });
      else {
        await client.dispatch({ type: 'setPreview', screen: 'live', sourceId: next }).catch(() => {});
        await client.dispatch({ type: 'take', screen: 'live', transition: 'fade', durationMs: 500 }).catch(() => {});
      }
      c.setShow((await client.getShow()).show);
    }
    now += 33;
    c.draw(now);
    if (frame === 2_000) peak = sizes();
  }
  // After warming up, nothing keeps growing with time.
  sizes().forEach((n, i) => expect(n).toBeLessThanOrEqual(Math.max(peak[i]!, ids.length + 2)));
  expect(depth).toBe(0);
  c.dispose();
});
