// The overlay renderer end to end, as far as a browser-less test can go: the
// real ProgramCompositor in graphics-only mode drawing into a tiny software
// canvas (fillRect and clearRect really paint), the planes it picks, the
// dirty rectangles it finds and the bytes it would send the engine.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defaultCountdown, DemoClient } from './client';
import { OverlayRenderer } from './overlayRenderer';
import { timecodeText } from './multiviewLabels';
import type { Show } from './types/Show';

/** getImageData calls (each is a plane drawn and compared). */
const reads = { n: 0 };

/** A 2D context that paints rectangles into real pixels (transforms ignored). */
function paintingContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  let px = new Uint8ClampedArray(0);
  const fit = () => {
    const n = canvas.width * canvas.height * 4;
    if (px.length !== n) px = new Uint8ClampedArray(n);
  };
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, fillStyle: '#000000' };
  const color = (): [number, number, number] => {
    const s = state.fillStyle;
    if (typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)) return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
    return [10, 20, 30];
  };
  const paint = (x: number, y: number, w: number, h: number, rgba: [number, number, number, number] | null) => {
    fit();
    const W = canvas.width;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(W, Math.ceil(x + w));
    const y1 = Math.min(canvas.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 4;
        if (rgba) px.set(rgba, i);
        else px.fill(0, i, i + 4);
      }
  };
  const methods: Record<string, (...a: number[]) => unknown> = {
    fillRect: (x, y, w, h) => paint(x!, y!, w!, h!, [...color(), Math.round(255 * Number(state.globalAlpha))]),
    clearRect: (x, y, w, h) => paint(x!, y!, w!, h!, null),
    // A rounded box (the captions' box) is painted as its rectangle.
    beginPath: () => void (state.path = null),
    roundRect: (x, y, w, h) => void (state.path = [x, y, w, h]),
    fill: () => {
      const p = state.path as number[] | null;
      if (p) paint(p[0]!, p[1]!, p[2]!, p[3]!, [...color(), Math.round(255 * Number(state.globalAlpha))]);
    },
    getImageData: (x, y, w, h) => {
      reads.n++;
      fit();
      const out = new Uint8ClampedArray(w! * h! * 4);
      for (let row = 0; row < h!; row++) out.set(px.subarray(((y! + row) * canvas.width + x!) * 4, ((y! + row) * canvas.width + x! + w!) * 4), row * w! * 4);
      return { data: out, width: w, height: h };
    },
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
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

/** What a message says (the engine's reading of it, enough for the tests). */
function read(bytes: Uint8Array): { op: number; screen: number; name: string; w: number; h: number; rects: number[][] }[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('LOV1');
  const n = v.getUint16(4, true);
  let at = 6;
  const out = [];
  for (let i = 0; i < n; i++) {
    const op = v.getUint8(at);
    const screen = v.getUint8(at + 1);
    const len = v.getUint16(at + 2, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 4, at + 4 + len));
    at += 4 + len;
    const w = v.getUint32(at, true);
    const h = v.getUint32(at + 4, true);
    const count = v.getUint32(at + 16, true);
    at += 20;
    const rects: number[][] = [];
    for (let r = 0; r < count; r++) {
      rects.push([0, 4, 8, 12].map((o) => v.getUint32(at + o, true)));
      at += 16;
    }
    for (const r of rects) at += r[2]! * r[3]! * 4;
    out.push({ op, screen, name, w, h, rects });
  }
  expect(at).toBe(bytes.length);
  return out;
}

let gum: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, type: string) {
    return type === '2d' ? paintingContext(this) : null;
  } as never);
  gum = vi.fn(() => Promise.reject(new Error('no cameras in tests')));
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: gum }, configurable: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const client = new DemoClient();
  await client.dispatch({ type: 'addSource', source: { id: 'cam', name: 'Camera', kind: { type: 'camera', deviceId: 'd', label: 'Cam' } } });
  await client.dispatch({
    type: 'addSource',
    source: { id: 'cd', name: 'Countdown', kind: { type: 'countdown', background: '#203040', timer: defaultCountdown() } },
  });
  await client.dispatch({ type: 'cutTo', screen: 'live', sourceId: 'cam' });
  const show = async (): Promise<Show> => (await client.getShow()).show;
  return { client, show };
}

test('a camera on air: nothing is drawn, nothing is sent, no camera is opened', async () => {
  const { client, show } = await setup();
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setShow(await show());
  // The first message only tells the engine to start clean.
  const first = r.frame(10_000);
  expect(read(first!).map((x) => x.op)).toEqual([3]);
  for (let t = 0; t < 120; t++) expect(r.frame(10_016 + t * 16)).toBeNull();
  expect(gum).not.toHaveBeenCalled();
  r.dispose();
});

test('a graphic going on air is sent once, then only when it changes, and cleared when it goes', async () => {
  const { client, show } = await setup();
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setShow(await show());
  r.frame(10_000);
  await client.dispatch({ type: 'cutTo', screen: 'live', sourceId: 'cd' });
  r.setShow(await show());
  const on = read(r.frame(20_000)!);
  expect(on.map((x) => [x.op, x.name, x.w, x.h])).toEqual([[1, 'g:cd', 160, 90]]);
  // Only where it drew (the rest of the plane is see-through: nothing to send).
  expect(on[0]!.rects.length).toBeGreaterThan(0);
  // The same picture again: nothing to send.
  expect(r.frame(20_016)).toBeNull();
  expect(r.frame(20_032)).toBeNull();
  // Back to the camera: the plane is cleared.
  await client.dispatch({ type: 'cutTo', screen: 'live', sourceId: 'cam' });
  r.setShow(await show());
  const off = read(r.frame(30_000)!);
  expect(off.map((x) => [x.op, x.name])).toEqual([[2, 'g:cd']]);
  expect(r.frame(30_016)).toBeNull();
  expect(gum).not.toHaveBeenCalled();
  r.dispose();
});

test('when the engine refuses a frame, everything is sent again from a clean start', async () => {
  const { client, show } = await setup();
  await client.dispatch({ type: 'cutTo', screen: 'live', sourceId: 'cd' });
  let fail = true;
  const sent: Uint8Array[] = [];
  let now = 50_000;
  const r = new OverlayRenderer(
    client,
    'live',
    160,
    90,
    60,
    (b) => {
      sent.push(b);
      return fail ? Promise.reject(new Error('refused')) : Promise.resolve();
    },
    () => now,
  );
  r.setShow(await show());
  r.tick();
  await Promise.resolve();
  await new Promise((res) => setTimeout(res, 0));
  expect(read(sent[0]!).map((x) => x.op)).toEqual([3, 1]);
  fail = false;
  now += 100;
  r.tick();
  await new Promise((res) => setTimeout(res, 0));
  // Reset, and the whole graphic again (the engine may have nothing of it).
  expect(read(sent[1]!).map((x) => [x.op, x.name])).toEqual([
    [3, ''],
    [1, 'g:cd'],
  ]);
  // Then quiet.
  now += 100;
  r.tick();
  await new Promise((res) => setTimeout(res, 0));
  expect(sent.length).toBe(2);
  r.dispose();
});

const look = { on: true, listen: null, inPicture: true, place: 'bottom' as const, size: 1, lines: 2, language: 'en', best: false };

test('captions are the Live plane `cap`, sent while there are lines and cleared after', async () => {
  const { client, show } = await setup();
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setShow(await show());
  r.frame(10_000);
  r.setCaptions({ lines: ['Hello there'], look });
  const on = read(r.frame(10_016)!);
  expect(on.map((x) => [x.op, x.screen, x.name, x.w, x.h])).toEqual([[1, 0, 'cap', 160, 90]]);
  // The same lines: not even drawn again.
  const before = reads.n;
  expect(r.frame(10_032)).toBeNull();
  expect(reads.n).toBe(before);
  r.setCaptions({ lines: [], look });
  expect(read(r.frame(10_048)!).map((x) => [x.op, x.name])).toEqual([[2, 'cap']]);
  // The Back Screen's renderer never writes captions.
  const b = new OverlayRenderer(client, 'back', 160, 90, 60, () => Promise.resolve());
  b.setShow(await show());
  b.setCaptions({ lines: ['Hello'], look });
  expect(read(b.frame(10_000)!).map((x) => x.op)).toEqual([3]);
  r.dispose();
  b.dispose();
});

test('the Next preview’s graphics go as half-size `n:` planes, only while they are wanted', async () => {
  const { client, show } = await setup();
  await client.dispatch({ type: 'setPreview', screen: 'live', sourceId: 'cd' });
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setShow(await show());
  r.frame(10_000);
  expect(r.frame(10_016)).toBeNull();
  r.setWants({ multiview: null, next: true, monitor: false });
  const on = read(r.frame(10_032)!);
  expect(on.map((x) => [x.op, x.screen, x.name, x.w, x.h])).toEqual([[1, 0, 'n:g:cd', 80, 45]]);
  r.setWants({ multiview: null, next: false, monitor: false });
  expect(read(r.frame(10_048)!).map((x) => [x.op, x.name])).toEqual([[2, 'n:g:cd']]);
  r.dispose();
});

test('the Monitor’s words go to the Monitor (screen 2) from the Live Screen’s renderer', async () => {
  const { client, show } = await setup();
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setWants({ multiview: null, next: false, monitor: true });
  r.setShow(await show());
  const first = read(r.frame(10_000)!);
  // A clean start for both, then the monitor's black page.
  expect(first.map((x) => [x.op, x.screen, x.name])).toEqual([
    [3, 0, ''],
    [3, 2, ''],
    [1, 2, 'mon'],
  ]);
  // Unchanged within a tenth of a second: not drawn again.
  const before = reads.n;
  expect(r.frame(10_050)).toBeNull();
  expect(reads.n).toBe(before);
  r.setWants({ multiview: null, next: false, monitor: false });
  expect(read(r.frame(10_100)!).map((x) => [x.op, x.screen, x.name])).toEqual([[2, 2, 'mon']]);
  r.dispose();
});

test('the multiview’s timecodes are small planes of their own, so the words plane is drawn once a second', async () => {
  const { client, show } = await setup();
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setShow(await show());
  r.setWants({
    multiview: {
      width: 192,
      height: 108,
      scale: 0.1,
      header: [0, 0, 192, 4],
      clock: [170, 0, 20, 4],
      tiles: [
        {
          content: { type: 'program', id: 'live' },
          rect: [0, 10, 96, 60],
          picture: [1, 11, 94, 55],
          label: [1, 66, 94, 3],
          tally: 'pgm',
          big: true,
          number: null,
          timecode: [80, 66, 15, 3],
        },
      ],
    },
    next: false,
    monitor: false,
  });
  const first = read(r.frame(10_000)!);
  expect(first.map((x) => x.name)).toContain('mv');
  const n = reads.n;
  r.frame(10_016);
  // The two timecodes are drawn again (they change every frame); the words are not.
  expect(reads.n - n).toBe(2);
  r.frame(11_000);
  expect(reads.n - n).toBe(5);
  r.dispose();
});

test('timecodes count frames', () => {
  const d = new Date(2026, 0, 1, 7, 3, 4, 500);
  expect(timecodeText(d, 60)).toBe('07:03:04:30');
  expect(timecodeText(new Date(2026, 0, 1, 7, 3, 4, 999), 30)).toBe('07:03:04:29');
});
