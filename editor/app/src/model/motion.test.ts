import { describe, expect, it } from 'vitest';
import { setKey, valueAt } from './anim';
import { composite, blendColor, BLEND_NAMES, type RGB } from './blend';
import { bezierAt, segmentValue, smooth } from './interp';
import { copyKeys, moveKeys, pasteKeys, scaleKeyTimes, setEases, setHandle, speedAt } from './keyops';
import {
  addFreeze,
  addRamp,
  addReverse,
  clipFrameFinder,
  clipFrameOf,
  enableRemap,
  rateAt,
  remapPosition,
  remapSourceAt,
  sampleFrames,
  soundPieces,
} from './remap';
import { shapeOutline, trimOutline, outlineLength, DEFAULT_SHAPE, type Pt } from './shapes';
import { charLooks, rangeAmount, textAnimatorPreset, textUnits } from './textanim';
import { BLEND_MODES } from '../render/shaders';
import { sourceAt } from '../render/frame';
import { newClip, type Anim, type Key, type Param, type TimeRemap } from './types';

const keys = (...k: Key[]): Anim => ({ k });

describe('keyframe interpolation', () => {
  it('keeps the original modes exactly as before', () => {
    const lin = keys({ t: 0, v: 0, e: 'linear' }, { t: 10, v: 100, e: 'linear' });
    expect(valueAt(lin, 2.5)).toBeCloseTo(25, 9);
    const ease = keys({ t: 0, v: 0, e: 'ease' }, { t: 10, v: 100, e: 'linear' });
    for (const t of [1, 3, 5, 7, 9]) expect(valueAt(ease, t)).toBeCloseTo(100 * smooth(t / 10), 9);
    const hold = keys({ t: 0, v: 5, e: 'hold' }, { t: 10, v: 100, e: 'linear' });
    expect(valueAt(hold, 9.99)).toBe(5);
    expect(valueAt(hold, 10)).toBe(100);
  });

  it('solves bezier curves for the frame', () => {
    // Straight handles make a straight line.
    for (const x of [0, 0.2, 0.5, 0.9, 1]) expect(bezierAt(1 / 3, 1 / 3, 2 / 3, 2 / 3, 0, 1, x)).toBeCloseTo(x, 6);
    // CSS ease-in-out (0.42, 0, 0.58, 1) is symmetric and passes the middle at the middle.
    expect(bezierAt(0.42, 0, 0.58, 1, 0, 1, 0.5)).toBeCloseTo(0.5, 6);
    expect(bezierAt(0.42, 0, 0.58, 1, 0, 1, 0.25) + bezierAt(0.42, 0, 0.58, 1, 0, 1, 0.75)).toBeCloseTo(1, 6);
  });

  it('eases in and out on the right side', () => {
    const inn = keys({ t: 0, v: 0, e: 'easeIn' }, { t: 30, v: 300, e: 'linear' });
    const out = keys({ t: 0, v: 0, e: 'easeOut' }, { t: 30, v: 300, e: 'linear' });
    // Ease in: fast at first, slow into the next key; ease out: slow to leave.
    expect(speedAt(inn, 1, 30)).toBeGreaterThan(speedAt(inn, 29, 30));
    expect(speedAt(out, 1, 30)).toBeLessThan(speedAt(out, 29, 30));
    expect(valueAt(inn, 15)).toBeGreaterThan(150);
    expect(valueAt(out, 15)).toBeLessThan(150);
  });

  it('auto bezier runs smoothly through the middle key without overshooting at peaks', () => {
    const p = keys({ t: 0, v: 0, e: 'auto' }, { t: 10, v: 50, e: 'auto' }, { t: 20, v: 100, e: 'auto' });
    // Through the middle key, the speed on both sides matches.
    expect(speedAt(p, 9.9, 1, 0.05)).toBeCloseTo(speedAt(p, 10.1, 1, 0.05), 0);
    const peak = keys({ t: 0, v: 0, e: 'auto' }, { t: 10, v: 100, e: 'auto' }, { t: 20, v: 0, e: 'auto' });
    for (let t = 0; t <= 20; t += 0.5) expect(valueAt(peak, t)).toBeLessThanOrEqual(100 + 1e-9);
  });

  it('custom handles shape the curve and the curve stays continuous when switched to bezier', () => {
    const base = keys({ t: 0, v: 0, e: 'easeOut' }, { t: 20, v: 100, e: 'linear' });
    const switched = setEases(base, [0], 'bezier');
    for (const t of [2, 5, 10, 15, 18]) expect(valueAt(switched, t)).toBeCloseTo(valueAt(base, t), 6);
    // An overshoot handle goes past the end value.
    const over = setHandle(switched, 20, 'i', [-5, 40]);
    expect(Math.max(...[12, 14, 16, 18].map((t) => valueAt(over, t)))).toBeGreaterThan(valueAt(base, 16));
    expect((over as Anim).k[0]?.e).toBe('bezier');
    expect(segmentValue((over as Anim).k, 0, 0)).toBeCloseTo(0, 9);
  });

  it('moves, scales, copies and pastes several keys', () => {
    const p = keys({ t: 0, v: 0, e: 'linear' }, { t: 10, v: 10, e: 'ease' }, { t: 20, v: 20, e: 'linear' });
    const moved = moveKeys(p, [10, 20], 5, 1) as Anim;
    expect(moved.k.map((k) => [k.t, k.v])).toEqual([
      [0, 0],
      [15, 11],
      [25, 21],
    ]);
    const scaled = scaleKeyTimes(p, [0, 10, 20], 0, 2) as Anim;
    expect(scaled.k.map((k) => k.t)).toEqual([0, 20, 40]);
    const copied = copyKeys(p, [10, 20]);
    expect(copied.map((k) => k.t)).toEqual([0, 10]);
    const pasted = pasteKeys(5 as Param, 100) as Anim;
    expect(pasted.k.map((k) => [k.t, k.v, k.e])).toEqual([
      [100, 10, 'ease'],
      [110, 20, 'linear'],
    ]);
    // A moved key replaces one it lands on.
    expect((moveKeys(p, [0], 10) as Anim).k.map((k) => [k.t, k.v])).toEqual([
      [10, 0],
      [20, 20],
    ]);
  });

  it('setKey keeps the handles of a key already there', () => {
    const p: Anim = {
      k: [
        { t: 0, v: 0, e: 'bezier', o: [3, 5] },
        { t: 10, v: 1, e: 'linear' },
      ],
    };
    expect(setKey(p, 0, 7).k[0]).toEqual({ t: 0, v: 7, e: 'bezier', o: [3, 5] });
  });
});

describe('time remapping', () => {
  const remap = (speed: Param, sampling: TimeRemap['sampling'] = 'nearest'): TimeRemap => ({ speed, sampling, pitch: true });

  it('maps clip frames to source frames at a steady speed', () => {
    const r = remap(50);
    expect(remapPosition(r, 100, 0)).toBe(0);
    expect(remapPosition(r, 100, 10)).toBeCloseTo(5, 9);
    expect(remapPosition(r, 100, 100)).toBeCloseTo(50, 9);
    // Spare footage either side carries on at the edge's speed.
    expect(remapPosition(r, 100, -4)).toBeCloseTo(-2, 9);
    expect(remapPosition(r, 100, 104)).toBeCloseTo(52, 9);
  });

  it('freezes and plays backwards', () => {
    const frozen = addFreeze(remap(100), 10, 5);
    const at = (f: number) => remapPosition(frozen, 60, f);
    expect(at(10)).toBeCloseTo(10, 9);
    for (let f = 10; f <= 15; f++) expect(at(f)).toBeCloseTo(10, 9);
    expect(at(16)).toBeCloseTo(11, 9);
    expect(at(30)).toBeCloseTo(25, 9);
    const back = addReverse(remap(100), 20, 10, 60);
    const b = (f: number) => remapPosition(back, 60, f);
    expect(b(20)).toBeCloseTo(20, 9);
    expect(b(25)).toBeCloseTo(15, 9);
    expect(b(30)).toBeCloseTo(10, 9);
    expect(b(31)).toBeCloseTo(11, 9);
    // Going from file position back to the clip frame.
    expect(clipFrameOf(back, 60, 15, 21)).toBe(25);
  });

  it('finds clip frames quickly, as the frame by frame search does', () => {
    const ramp = addFreeze(addRamp(remap(100), 10, 20, 250, 90), 50, 6);
    const back = addReverse(remap(80), 20, 10, 60);
    for (const [r, n] of [
      [ramp, 90],
      [back, 60],
      [remap(37), 120],
    ] as [TimeRemap, number][]) {
      const find = clipFrameFinder(r, n);
      for (let x = -3; x < 200; x += 0.37) expect(find(x)).toBe(clipFrameOf(r, n, x));
      for (let f = 0; f <= n; f++) expect(find(remapPosition(r, n, f))).toBe(clipFrameOf(r, n, remapPosition(r, n, f)));
    }
  });

  it('turns a clip into a remapped one without changing what it shows', () => {
    const c = { ...newClip('v', 0, 30, { kind: 'media', media: 'm', in: 2 }, 'c'), reverse: true };
    const before = [0, 7, 29].map((f) => sourceAt(c, f, 30));
    const r = enableRemap(c, 30);
    expect([0, 7, 29].map((f) => sourceAt(r, f, 30))).toEqual(before.map((x) => expect.closeTo(x, 9)));
    expect(rateAt(r, 3)).toBe(-1);
    expect(remapSourceAt(r, r.remap as TimeRemap, 0, 30)).toBeCloseTo(2 + 29 / 30, 9);
  });

  it('samples between the file frames by mode', () => {
    expect(sampleFrames(0.5 / 30 + 1 / 30, 30, 'nearest')).toEqual({ time: 2 / 30, next: null, mix: 0 });
    const b = sampleFrames(1.25 / 30, 30, 'blend');
    expect(b.time).toBeCloseTo(1 / 30, 9);
    expect(b.next).toBeCloseTo(2 / 30, 9);
    expect(b.mix).toBeCloseTo(0.25, 6);
    expect(sampleFrames(3 / 30, 30, 'flow').next).toBeNull();
  });

  it('cuts the sound into pieces of one speed (freezes are their own piece)', () => {
    const c = { ...newClip('a', 0, 60, { kind: 'media', media: 'm', in: 0 }, 'c'), remap: addFreeze(remap(100), 20, 10) };
    const pieces = soundPieces(c, 0, 60, 30);
    expect(pieces.map((x) => [x.from, x.to, x.rate])).toEqual([
      [0, 20, 1],
      [20, 30, 0],
      [30, 60, 1],
    ]);
    const ramp: Param = {
      k: [
        { t: 0, v: 100, e: 'linear' },
        { t: 30, v: 25, e: 'linear' },
      ],
    };
    const r = soundPieces({ ...c, remap: remap(ramp) }, 0, 30, 30);
    expect(r.length).toBeGreaterThan(3);
    expect(r[0]?.from).toBe(0);
    expect(r[r.length - 1]?.to).toBe(30);
  });
});

describe('blend modes', () => {
  const B: RGB = [0.2, 0.5, 0.8];
  const S: RGB = [0.6, 0.3, 0.9];
  it('the GPU and the CPU agree on the order', () => {
    expect(BLEND_MODES).toEqual(BLEND_NAMES);
    expect(BLEND_NAMES.slice(0, 9)).toEqual(['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'difference', 'softlight']);
    expect(BLEND_NAMES).toHaveLength(17);
  });
  it('separable modes', () => {
    expect(blendColor('multiply', B, S)[0]).toBeCloseTo(0.12, 9);
    expect(blendColor('screen', B, S)[0]).toBeCloseTo(0.2 + 0.6 - 0.12, 9);
    expect(blendColor('exclusion', B, S)[1]).toBeCloseTo(0.5 + 0.3 - 0.3, 9);
    expect(blendColor('colordodge', B, S)[0]).toBeCloseTo(0.5, 9);
    expect(blendColor('colorburn', B, S)[0]).toBeCloseTo(1 - 0.8 / 0.6 > 0 ? 1 - 0.8 / 0.6 : 0, 9);
    expect(blendColor('hardlight', B, S)[1]).toBeCloseTo(0.5 * 0.6, 9);
    // Overlay is hard light with the layers swapped.
    expect(blendColor('overlay', B, S)).toEqual(blendColor('hardlight', S, B));
    expect(blendColor('difference', B, S)[2]).toBeCloseTo(0.1, 9);
  });
  it('non-separable modes keep the backdrop luminosity (or take the layer’s)', () => {
    const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    for (const m of ['hue', 'saturation', 'color'] as const) expect(lum(blendColor(m, B, S))).toBeCloseTo(lum(B), 6);
    expect(lum(blendColor('luminosity', B, S))).toBeCloseTo(lum(S), 6);
    // Color on gray gives gray's lightness with the layer's hue.
    const c = blendColor('color', [0.5, 0.5, 0.5], [1, 0, 0]);
    expect(c[0]).toBeGreaterThan(c[1]);
  });
  it('composites premultiplied colors with opacity', () => {
    expect(composite('normal', [0, 0, 1, 1], [1, 0, 0, 1], 0.5)).toEqual([0.5, 0, 0.5, 1]);
    const m = composite('multiply', [0.5, 0.5, 0.5, 1], [1, 0.5, 0, 1]);
    expect(m.map((x) => Number(x.toFixed(6)))).toEqual([0.5, 0.25, 0, 1]);
    // Over nothing, a blend mode shows the layer as it is.
    expect(composite('difference', [0, 0, 0, 0], [0.3, 0.2, 0.1, 1])).toEqual([0.3, 0.2, 0.1, 1]);
  });
});

describe('text animators', () => {
  it('counts letters (no spaces), words and lines', () => {
    const u = textUnits(['Hi there', 'you']);
    expect(u.chars).toBe(10);
    expect(u.words).toBe(3);
    expect(u.lines).toBe(2);
    expect(u.units.map((x) => x.word)).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2]);
  });
  it('range selector shapes', () => {
    const r = { start: 0, end: 50, offset: 0, shape: 'square' as const, amount: 100 };
    expect([0, 1, 2, 3].map((i) => rangeAmount(i, 4, r))).toEqual([1, 1, 0, 0]);
    // Half a unit covered.
    expect(rangeAmount(1, 4, { ...r, end: 37.5 })).toBeCloseTo(0.5, 9);
    expect(rangeAmount(1, 4, { ...r, end: 37.5, hard: true })).toBe(1);
    // Offset slides the range along; reverse counts from the end.
    expect([0, 1, 2, 3].map((i) => rangeAmount(i, 4, { ...r, offset: 50 }))).toEqual([0, 0, 1, 1]);
    expect([0, 1, 2, 3].map((i) => rangeAmount(i, 4, { ...r, reverse: true }))).toEqual([0, 0, 1, 1]);
    const ramp = { start: 0, end: 100, offset: 0, shape: 'rampUp' as const, amount: 50 };
    expect([0, 1, 2, 3].map((i) => rangeAmount(i, 4, ramp))).toEqual([0.0625, 0.1875, 0.3125, 0.4375]);
    expect(rangeAmount(1, 4, { ...ramp, shape: 'triangle', amount: 100 })).toBeCloseTo(0.75, 9);
  });
  it('typewriter shows letters one by one', () => {
    const an = textAnimatorPreset('typewriter', 10);
    const u = textUnits(['abcde']);
    const shown = (f: number) => charLooks([an], u, f).filter((l) => l.opacity > 0.5).length;
    expect(shown(0)).toBe(0);
    expect(shown(4)).toBe(2);
    expect(shown(10)).toBe(5);
  });
  it('fade up by word moves whole words', () => {
    const an = textAnimatorPreset('fadeUpWord', 20);
    const looks = charLooks([an], textUnits(['one two']), 0);
    expect(looks[0]?.y).toBeCloseTo(looks[2]?.y ?? NaN, 9);
    expect(looks[0]?.y).not.toBeCloseTo(looks[4]?.y ?? NaN, 3);
    expect(charLooks([an], textUnits(['one two']), 20).every((l) => l.opacity === 1 && l.y === 0)).toBe(true);
  });
});

describe('shape layers', () => {
  const sq = (pts: Pt[]) => pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
  it('outlines', () => {
    const rect = shapeOutline({ ...DEFAULT_SHAPE, w: 200, h: 100 });
    expect(sq(rect.pts)).toEqual([
      [0, -50],
      [100, -50],
      [100, 50],
      [-100, 50],
      [-100, -50],
    ]);
    expect(outlineLength(rect.pts, true)).toBeCloseTo(600, 6);
    expect(shapeOutline({ ...DEFAULT_SHAPE, kind: 'star', sides: 5 }).pts).toHaveLength(10);
    expect(shapeOutline({ ...DEFAULT_SHAPE, kind: 'polygon', sides: 6 }).pts).toHaveLength(6);
    // Rounded corners are shorter than sharp ones.
    expect(outlineLength(shapeOutline({ ...DEFAULT_SHAPE, w: 200, h: 100, corner: 20 }).pts, true)).toBeLessThan(600);
  });
  it('trims paths', () => {
    const { pts } = shapeOutline({ ...DEFAULT_SHAPE, w: 200, h: 100 });
    const half = trimOutline(pts, true, 0, 50, 0);
    expect(half).toHaveLength(1);
    expect(outlineLength(half[0] as Pt[], false)).toBeCloseTo(300, 6);
    expect(trimOutline(pts, true, 30, 30, 0)).toEqual([]);
    // Across the start of a closed outline: still one line of the right length.
    const wrap = trimOutline(pts, true, 0, 25, 90);
    expect(wrap).toHaveLength(1);
    expect(outlineLength(wrap[0] as Pt[], false)).toBeCloseTo(150, 6);
    // An open line is cut at its end.
    const line = shapeOutline({ ...DEFAULT_SHAPE, kind: 'line', w: 100 });
    expect(outlineLength(trimOutline(line.pts, false, 0, 50, 75)[0] as Pt[], false)).toBeCloseTo(25, 6);
  });
});
