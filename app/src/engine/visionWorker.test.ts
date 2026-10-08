// The vision worker with a stand-in model: it answers only for the inputs
// the engine sends (those that use the effects), passes on the mask and
// where auto-framing aims, sends a picture behind people once, and sends it
// again when the engine asks for everything.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { emptyShow } from './client';
import { demoApply } from './demo';
import type { Shot } from './vision';
import { VisionWorker, type VisionModel } from './visionWorker';
import type { Show } from './types/Show';

/** The engine's frames message for these inputs (2 × 1 pixels each). */
function frames(ids: string[]): Uint8Array {
  const parts: number[] = [0x4c, 0x56, 0x46, 0x31, ids.length, 0];
  for (const id of ids) {
    const b = [...new TextEncoder().encode(id)];
    parts.push(b.length, 0, ...b, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, ...new Array(8).fill(128));
  }
  return new Uint8Array(parts);
}

class FakeModel implements VisionModel {
  mask = { w: 2, h: 1, data: new Uint8Array([255, 0]) };
  aim: Shot = { cx: 0.3, cy: 0.5, zoom: 2 };
  broken = false;
  updates = 0;
  update(): void {
    this.updates++;
  }
}

let show: Show;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  let s = emptyShow();
  for (const id of ['blurred', 'framed', 'set']) {
    s = demoApply(s, { type: 'addSource', source: { id, name: id, kind: { type: 'camera', deviceId: id, label: id } } }, 1000);
  }
  const cam = (id: string) => s.sources.find((x) => x.id === id)!;
  cam('blurred').background = { mode: 'blur', blur: 0.5, edge: 0.4 };
  cam('framed').autoFrame = { enabled: true, who: 'everyone', tightness: 0.5, speed: 0.4, keepSharp: true };
  cam('set').background = { mode: 'set', blur: 0.5, edge: 0.4, set: 'news' };
  show = s;
});
afterEach(() => vi.restoreAllMocks());

test('answers with the mask and where auto-framing aims, for the inputs the engine sent', async () => {
  const sent: Uint8Array[] = [];
  const models: FakeModel[] = [];
  const w = new VisionWorker({
    frames: () => Promise.resolve(frames(['blurred', 'framed', 'gone'])),
    send: (b) => {
      sent.push(b);
      return Promise.resolve();
    },
    outW: 1920,
    makeModel: () => {
      const m = new FakeModel();
      models.push(m);
      return m;
    },
  });
  w.setShow(show);
  await w.step();
  expect(models).toHaveLength(2);
  expect(models.every((m) => m.updates === 1)).toBe(true);
  const b = sent[0]!;
  const text = new TextDecoder().decode(b);
  expect(text.startsWith('LVR1')).toBe(true);
  expect(b[4]).toBe(2);
  // "blurred": its mask (flags 1), no shot; "framed": no mask (its background stays), a shot (flags 2).
  const at = 6 + 2 + 'blurred'.length;
  expect(b[at]).toBe(1);
  const at2 = at + 1 + 4 + 2 + 2 + 'framed'.length;
  expect(b[at2]).toBe(2);
  expect(new DataView(b.buffer).getFloat32(at2 + 1, true)).toBeCloseTo(0.3);
  expect(w.stats.frames).toBe(2);
});

test('a picture behind people goes once, and again after the engine asked for everything', async () => {
  const sent: Uint8Array[] = [];
  let refuse = false;
  const backdrop = vi.fn(() => ({ key: 'set|news', back: { w: 1, h: 1, rgba: new Uint8Array([1, 2, 3, 255]) }, front: null }));
  const w = new VisionWorker({
    frames: () => Promise.resolve(frames(['set'])),
    send: (b) => {
      sent.push(b);
      return refuse ? Promise.reject(new Error('send everything')) : Promise.resolve();
    },
    outW: 1920,
    makeModel: () => new FakeModel(),
    backdrop,
  });
  w.setShow(show);
  const flags = (b: Uint8Array) => b[6 + 2 + 3];
  await w.step();
  expect(flags(sent[0]!)).toBe(1 | 4 | 8);
  await w.step();
  expect(flags(sent[1]!)).toBe(1);
  refuse = true;
  await w.step();
  refuse = false;
  await w.step();
  expect(flags(sent[3]!)).toBe(1 | 4 | 8);
  expect(w.stats.refused).toBe(1);
});

test('a broken model sends no mask, so the picture shows as it is', async () => {
  const sent: Uint8Array[] = [];
  const w = new VisionWorker({
    frames: () => Promise.resolve(frames(['blurred'])),
    send: (b) => {
      sent.push(b);
      return Promise.resolve();
    },
    outW: 1920,
    makeModel: () => Object.assign(new FakeModel(), { broken: true }),
  });
  w.setShow(show);
  await w.step();
  expect(sent[0]![6 + 2 + 'blurred'.length]).toBe(0);
});
