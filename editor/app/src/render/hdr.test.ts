import { describe, expect, it } from 'vitest';
import {
  hdrTags,
  hlgInverseOetf,
  hlgOetf,
  hlgToNits,
  HDR_GLSL,
  isHdr,
  nitsToHlg,
  pqDecode,
  pqEncode,
  REF_WHITE,
  rollOff,
  scopeGuides,
  sdrToSpace,
  spaceToSdr,
  M709_TO_2020,
  M2020_TO_709,
} from './hdr';

const close = (a: number, b: number, d = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('HDR color', () => {
  it('PQ codes nits as SMPTE ST 2084 says', () => {
    close(pqEncode(0), 0, 1e-6);
    close(pqEncode(10000), 1, 1e-6);
    // Well-known points: 100 nits ≈ 0.508, 203 ≈ 0.581, 1000 ≈ 0.752.
    close(pqEncode(100), 0.508, 2e-3);
    close(pqEncode(203), 0.581, 2e-3);
    close(pqEncode(1000), 0.752, 2e-3);
    for (const n of [0.1, 5, 100, 203, 1000, 4000]) close(pqDecode(pqEncode(n)) / n, 1, 1e-4);
  });

  it('HLG puts SDR white (203 nits) at 75% on a 1000-nit display, as BT.2408 says', () => {
    for (const e of [0, 0.01, 1 / 12, 0.3, 1]) close(hlgInverseOetf(hlgOetf(e)), e, 1e-6);
    close(hlgOetf(1), 1, 1e-6);
    const white = nitsToHlg([REF_WHITE, REF_WHITE, REF_WHITE]);
    close(white[0], 0.75, 3e-3);
    const back = hlgToNits(white);
    close(back[1] / REF_WHITE, 1, 1e-3);
    close(hlgToNits([1, 1, 1])[0], 1000, 0.5);
  });

  it('the Rec. 709 → 2020 → 709 conversions undo each other, and keep white', () => {
    const row = (m: number[], i: number) => (m[i * 3] as number) + (m[i * 3 + 1] as number) + (m[i * 3 + 2] as number);
    for (let i = 0; i < 3; i++) {
      close(row(M709_TO_2020, i), 1, 1e-4);
      close(row(M2020_TO_709, i), 1, 1e-3);
    }
  });

  it('an SDR picture keeps its look through an HDR sequence (up to the highlight roll-off)', () => {
    for (const space of ['pq', 'hlg'] as const) {
      for (const c of [
        [0.2, 0.4, 0.6],
        [0.5, 0.5, 0.5],
        [0.8, 0.1, 0.1],
      ] as [number, number, number][]) {
        const back = spaceToSdr(sdrToSpace(c, space), space);
        for (let i = 0; i < 3; i++) close(back[i] as number, c[i] as number, 3e-3);
      }
      // White sits just under the top, where the roll-off starts to bend.
      const w = spaceToSdr(sdrToSpace([1, 1, 1], space), space);
      expect(w[0]).toBeGreaterThan(0.985);
      expect(w[0]).toBeLessThanOrEqual(1);
    }
    close(sdrToSpace([1, 1, 1], 'pq')[0], pqEncode(203), 1e-6);
    expect(sdrToSpace([0.3, 0.2, 0.1], 'rec709')).toEqual([0.3, 0.2, 0.1]);
  });

  it('highlights above SDR white roll off smoothly instead of clipping', () => {
    expect(rollOff(0.5)).toBe(0.5);
    expect(rollOff(2)).toBeLessThan(1);
    expect(rollOff(4)).toBeGreaterThan(rollOff(2));
    const bright = spaceToSdr([pqEncode(1000), pqEncode(1000), pqEncode(1000)], 'pq');
    const brighter = spaceToSdr([pqEncode(4000), pqEncode(4000), pqEncode(4000)], 'pq');
    expect(bright[0]).toBeLessThanOrEqual(brighter[0]);
    expect(brighter[0]).toBeLessThanOrEqual(1);
  });

  it('scopes mark nits for HDR and percent for SDR', () => {
    const pq = scopeGuides('pq');
    expect(pq.map((g) => g[1])).toEqual(['0', '100', '203', '1k', '4k', '10k']);
    close(pq[2]?.[0] as number, 0.581, 2e-3);
    expect(scopeGuides('rec709').map((g) => g[1])).toEqual(['0', '25', '50', '75', '100']);
  });

  it('HDR films are tagged Rec. 2020 with PQ or HLG; HEVC carries the HDR10 details', () => {
    const pq = hdrTags('pq', 'libx265');
    expect(pq).toContain('smpte2084');
    expect(pq.join(' ')).toContain('hdr10=1');
    expect(pq.join(' ')).toContain('master-display=');
    const hlg = hdrTags('hlg', 'libx265');
    expect(hlg).toContain('arib-std-b67');
    expect(hlg.join(' ')).not.toContain('hdr10');
    expect(hdrTags('pq', 'prores_ks')).not.toContain('-x265-params');
  });

  it('knows HDR sequences, and its GLSL has every function the passes use', () => {
    expect(isHdr({ color: 'pq' })).toBe(true);
    expect(isHdr({})).toBe(false);
    for (const f of ['pqEncode', 'pqDecode', 'hlgToNits', 'nitsToHlg', 'toNits', 'fromNits', 'toSdrScreen']) expect(HDR_GLSL).toContain(`${f}(`);
  });
});
