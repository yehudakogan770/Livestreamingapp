// Native playback's decisions (when it draws, at what size, how far ahead)
// and the bytes it sends (the engine's tests read the same message back).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MediaItem, Sequence } from '../../model/types';
import { nativeLight } from '../../ui/NativeBadge';
import { aheadFrames, brokenIn, frameSize, useNative } from './client';
import { encodeFrame } from './message';
import { pack } from './msgpack';
import type { Recorded } from './record';
import { hash, nativeFile } from './resources';

const FIXTURE = resolve(__dirname, '../../../../../crates/studio-engine/tests/frame.bin');

/** A small MessagePack reader, to check the writer. */
function unpack(b: Uint8Array): unknown {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 0;
  const str = (n: number) => {
    const s = new TextDecoder().decode(b.subarray(i, i + n));
    i += n;
    return s;
  };
  const read = (): unknown => {
    const t = b[i++] as number;
    if (t < 0x80) return t;
    if (t >= 0xe0) return t - 0x100;
    if ((t & 0xf0) === 0x80) return map(t & 0x0f);
    if ((t & 0xf0) === 0x90) return arr(t & 0x0f);
    if ((t & 0xe0) === 0xa0) return str(t & 0x1f);
    switch (t) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xcc:
        return b[i++];
      case 0xcd:
        return ((i += 2), v.getUint16(i - 2));
      case 0xce:
        return ((i += 4), v.getUint32(i - 4));
      case 0xd2:
        return ((i += 4), v.getInt32(i - 4));
      case 0xcb:
        return ((i += 8), v.getFloat64(i - 8));
      case 0xd9:
        return str(b[i++] as number);
      case 0xda:
        return ((i += 2), str(v.getUint16(i - 2)));
      case 0xdc:
        return ((i += 2), arr(v.getUint16(i - 2)));
      case 0xde:
        return ((i += 2), map(v.getUint16(i - 2)));
      case 0xc4: {
        const n = b[i++] as number;
        i += n;
        return b.slice(i - n, i);
      }
      default:
        throw new Error(`type ${t.toString(16)}`);
    }
  };
  const arr = (n: number) => Array.from({ length: n }, read);
  const map = (n: number) => {
    const o: Record<string, unknown> = {};
    for (let k = 0; k < n; k++) o[read() as string] = read();
    return o;
  };
  return read();
}

const seq = { width: 3840, height: 2160 } as Sequence;

describe('native playback decisions', () => {
  it('draws natively only when on, running, uncovered and drawable', () => {
    const base = { enabled: true, status: 'on' as const, covered: false, frameOk: true };
    expect(useNative(base)).toBe(true);
    expect(useNative({ ...base, enabled: false })).toBe(false);
    for (const status of ['off', 'starting', 'failed', 'unavailable'] as const) expect(useNative({ ...base, status })).toBe(false);
    // A menu over the viewer, or a frame with something only WebGL does: WebGL draws.
    expect(useNative({ ...base, covered: true })).toBe(false);
    expect(useNative({ ...base, frameOk: false })).toBe(false);
  });

  it('draws at the size WebGL would', () => {
    expect(frameSize(seq, 540, 2, false, 1)).toEqual({ w: 1920, h: 1080 });
    expect(frameSize(seq, 540, 2, true, 0.5)).toEqual({ w: 960, h: 540 });
    // Never bigger than the sequence, never smaller than 90 rows.
    expect(frameSize(seq, 4000, 2, false, 1).h).toBe(2160);
    expect(frameSize(seq, 10, 1, false, 1).h).toBe(90);
  });

  it('sends a quarter second ahead, more when fast', () => {
    expect(aheadFrames(30, 1)).toBe(8);
    expect(aheadFrames(24, 1)).toBe(6);
    expect(aheadFrames(30, 4)).toBe(12);
    expect(aheadFrames(5, 1)).toBe(2);
  });

  it('notices programs the graphics card refused', () => {
    const rec = {
      passes: [
        { k: 0, t: 0 },
        { k: 1, t: 1, p: 'glow' },
      ],
    } as Recorded;
    expect(brokenIn(rec, new Set(['vhs']))).toBeNull();
    expect(brokenIn(rec, new Set(['glow']))).toBe('glow');
  });

  it('decodes the original, or a proxy when asked', () => {
    const m = { path: '/a.mov', proxy: '/a.edit.mp4', playbackProxy: '/a.proxy.mp4', source: { hdr: false } } as MediaItem;
    expect(nativeFile(m, true)).toBe('/a.proxy.mp4');
    expect(nativeFile(m, false)).toBe('/a.mov');
    expect(nativeFile({ ...m, source: { hdr: true } } as MediaItem, false)).toBe('/a.edit.mp4');
    expect(nativeFile({ ...m, missing: true }, false)).toBe('/a.edit.mp4');
    expect(nativeFile({ ...m, missing: true, proxy: null }, false)).toBeNull();
  });

  it('names pictures by what they look like', () => {
    expect(hash('a')).toBe(hash('a'));
    expect(hash('a')).not.toBe(hash('b'));
  });

  it('says how it is in the viewer light', () => {
    expect(nativeLight({ enabled: false, status: 'off', message: '' }).level).toBe('idle');
    expect(nativeLight({ enabled: true, status: 'on', message: 'GPU' }).level).toBe('ok');
    expect(nativeLight({ enabled: true, status: 'starting', message: '' }).level).toBe('warn');
    const failed = nativeLight({ enabled: true, status: 'failed', message: 'no adapter' });
    expect(failed.level).toBe('bad');
    expect(failed.title).toContain('no adapter');
  });
});

describe('native frame messages', () => {
  it('writes MessagePack that reads back the same', () => {
    const v = { a: 1, b: -3, c: 300, d: 70000, e: 0.5, f: 'héllo', g: [true, false, null], h: { x: [1, 2, 3] }, i: -100000, j: 1e12, k: 'x'.repeat(40) };
    expect(unpack(pack(v))).toEqual(v);
    expect(unpack(pack({ skip: undefined, keep: 1 }))).toEqual({ keep: 1 });
    expect(unpack(pack(new Uint8Array([1, 2])))).toEqual(new Uint8Array([1, 2]));
  });

  it('lays a frame out as header then pixels', () => {
    const rec: Recorded = {
      w: 64,
      h: 36,
      background: [0, 0, 0],
      out: 0,
      passes: [
        { k: 0, t: 0, c: [0, 0, 0, 0] },
        {
          k: 1,
          t: 0,
          p: 'layer',
          x: { uTex: 'v0' },
          u: { uCrop: [0, 0, 1, 1], uSize: [64, 36] },
          q: [-1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, -1, -1, 0, 1, 0, 1, 1, -1, 0, 1, 1, 1],
        },
        { k: 1, t: 1, p: 'copy', x: { uTex: 't0' }, u: { uOpacity: [0.5], uSize: [64, 36] } },
      ],
      videos: [{ key: 'c1', path: '/clip.mov', time: 1.5, fps: 25, w: 3840, h: 2160, rate: 1 }],
    };
    rec.out = 1;
    const curve = new Uint8Array(1024).fill(9);
    const bytes = encodeFrame(42, rec, [{ id: 'curve:a|1', w: 256, h: 1, d: 0, kind: 'raw', data: curve }], ['text:x|0'], true);
    const len = new DataView(bytes.buffer).getUint32(0, true);
    const header = unpack(bytes.subarray(4, 4 + len)) as Record<string, unknown>;
    expect(header.frame).toBe(42);
    expect(header.now).toBe(true);
    expect(header.free).toEqual(['text:x|0']);
    expect(header.uploads).toEqual([{ id: 'curve:a|1', w: 256, h: 1, d: 0, kind: 'raw', at: 0, len: 1024 }]);
    expect(bytes.length).toBe(4 + len + 1024);
    expect(bytes[4 + len]).toBe(9);
    // The engine's tests read this same message (UPDATE_SHADERS=1 writes it again).
    if (process.env.UPDATE_SHADERS) writeFileSync(FIXTURE, bytes);
    expect(new Uint8Array(readFileSync(FIXTURE))).toEqual(bytes);
  });
});
