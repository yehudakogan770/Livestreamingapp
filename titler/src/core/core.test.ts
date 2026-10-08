import { describe, expect, it } from 'vitest';
import { contrast, fill, formatValue, readableOn, resolveColor, tokensFor, usedVariables, valuesFor, variablesIn, keyFrom, DEFAULT_TOKENS } from './binding';
import { cloneLayers, newComposition, newProject, newShape, newText } from './build';
import { cubicBezier, keys, removeKey, setEase, setKey, setValue, toggleKeys, valueAt } from './easing';
import { layoutText, parseRich, plainText, type Measure } from './layout';
import { fileName, pack, unpack } from './package';
import { ellipsePath, flatten, pathBounds, rectPath, svgPathD, traceTrimmed } from './paths';
import { selection, worldMatrix } from './render';
import { apply } from './matrix';
import { starterTemplates, fromTemplate, CATEGORIES } from './templates';
import { clipTime, cueTime, cleanMarkers } from './timeline';
import { readProject, parseProject } from './validate';
import type { Keyframe, TextAnimator, TextStyle, Vec2 } from './types';
import { textStyle } from './build';

describe('easing and keyframes', () => {
  it('cubic bezier: ends fixed, linear is linear, ease-out is ahead early', () => {
    expect(cubicBezier(0.42, 0, 0.58, 1, 0)).toBe(0);
    expect(cubicBezier(0.42, 0, 0.58, 1, 1)).toBe(1);
    expect(cubicBezier(0, 0, 1, 1, 0.3)).toBeCloseTo(0.3, 5);
    expect(cubicBezier(0, 0, 0.58, 1, 0.25)).toBeGreaterThan(0.35);
    expect(cubicBezier(0.42, 0, 1, 1, 0.25)).toBeLessThan(0.15);
    // Ease in and out is symmetric.
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 4);
  });

  it('overshoot goes past the target', () => {
    let max = 0;
    for (let x = 0; x <= 1; x += 0.01) max = Math.max(max, cubicBezier(0.34, 1.4, 0.64, 1, x));
    expect(max).toBeGreaterThan(1);
  });

  it('values between keys, held before the first and after the last', () => {
    const p = keys<number>([1, 0], [3, 100]);
    expect(valueAt(p, 0, -1)).toBe(0);
    expect(valueAt(p, 2, -1)).toBeCloseTo(50);
    expect(valueAt(p, 9, -1)).toBe(100);
    expect(valueAt({ v: 7 }, 5, 0)).toBe(7);
    expect(valueAt(undefined, 5, 3)).toBe(3);
  });

  it('eased segments use the leaving key and the arriving key handles', () => {
    const p = keys<number>([0, 0, 'easeInOut'], [1, 100]);
    expect(valueAt(p, 0.25, 0)).toBeLessThan(25);
    expect(valueAt(p, 0.75, 0)).toBeGreaterThan(75);
    expect(valueAt(p, 0.5, 0)).toBeCloseTo(50, 1);
  });

  it('hold keys jump', () => {
    const p = keys<number>([0, 10, 'hold'], [1, 20]);
    expect(valueAt(p, 0.99, 0)).toBe(10);
    expect(valueAt(p, 1, 0)).toBe(20);
  });

  it('points interpolate, and a motion path curves at even speed', () => {
    const straight = keys<Vec2>([0, [0, 0]], [2, [100, 50]]);
    expect(valueAt(straight, 1, [0, 0])).toEqual([50, 25]);
    const curve: Keyframe<Vec2>[] = [
      { t: 0, v: [0, 0], so: [0, -100] },
      { t: 1, v: [100, 0], si: [0, -100] },
    ];
    const mid = valueAt({ k: curve }, 0.5, [0, 0]);
    expect(mid[0]).toBeCloseTo(50, 0);
    expect(mid[1]).toBeLessThan(-50);
    // Even speed: equal time steps cover about equal distances.
    const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => valueAt({ k: curve }, t, [0, 0]));
    const d = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
    expect(Math.max(...d) / Math.min(...d)).toBeLessThan(1.1);
  });

  it('editing keys: set, change, ease, remove, toggle', () => {
    let p = setKey<number>(undefined, 1, 5);
    p = setKey(p, 0, 0);
    expect(p.k!.map((k) => k.t)).toEqual([0, 1]);
    p = setValue(p, 1, 9);
    expect(valueAt(p, 1, 0)).toBe(9);
    p = setEase(p, 0, 'easeOut');
    expect(p.k![0]!.o).toEqual([0, 0]);
    expect(p.k![1]!.i).toEqual([0.58, 1]);
    p = removeKey(p, 0, 0);
    expect(p.k!.length).toBe(1);
    expect(removeKey(p, 1, 0)).toEqual({ v: 9 });
    expect(toggleKeys({ v: 3 }, 2, 0)).toEqual({ k: [{ t: 2, v: 3 }] });
    expect(toggleKeys(keys<number>([0, 1], [1, 3]), 0.5, 0)).toEqual({ v: 2 });
    expect(setValue({ v: 1 }, 4, 2)).toEqual({ v: 2 });
  });
});

describe('IN / HOLD / OUT', () => {
  const c = newComposition('t', 1920, 1080, 30, 6);
  c.markers = { inEnd: 1, outStart: 5, loop: null };

  it('plays the IN, then holds, then the OUT once taken off', () => {
    expect(cueTime(c, 0.5, null)).toEqual({ t: 0.5, phase: 'in' });
    expect(cueTime(c, 3, null)).toEqual({ t: 3, phase: 'hold' });
    expect(cueTime(c, 60, null)).toEqual({ t: 5, phase: 'hold' });
    expect(cueTime(c, 60, 0.5)).toEqual({ t: 5.5, phase: 'out' });
    expect(cueTime(c, 60, 2).phase).toBe('done');
  });

  it('repeats the loop while holding', () => {
    const l = { ...c, markers: { inEnd: 1, outStart: 5, loop: { start: 2, end: 4 } } };
    expect(cueTime(l, 1.5, null).t).toBe(1.5);
    expect(cueTime(l, 4.5, null).t).toBeCloseTo(2.5);
    expect(cueTime(l, 102.5, null).t).toBeCloseTo(2.5);
  });

  it('a title clip plays IN from its start and OUT to its end', () => {
    expect(clipTime(c, 0.5, 10).phase).toBe('in');
    expect(clipTime(c, 5, 10)).toEqual({ t: 5, phase: 'hold' });
    expect(clipTime(c, 9.5, 10)).toEqual({ t: 5.5, phase: 'out' });
    // A clip shorter than IN + OUT still ends with the OUT.
    expect(clipTime(c, 1.4, 1.5).phase).toBe('out');
  });

  it('markers are kept in order', () => {
    expect(cleanMarkers({ inEnd: 9, outStart: 2, loop: { start: 5, end: 1 } }, 6)).toEqual({ inEnd: 6, outStart: 6, loop: null });
    expect(cleanMarkers({ inEnd: NaN, outStart: 3 }, 6)).toEqual({ inEnd: 0, outStart: 3, loop: null });
  });
});

/** A measure that needs no fonts: every letter is half the size wide (capitals 0.7). */
const fake: Measure = (font, text) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  return [...text].reduce((w, ch) => w + (ch === ch.toUpperCase() && ch !== ' ' ? 0.7 : 0.5) * px, 0);
};
const style = (over: Partial<TextStyle> = {}) => textStyle({ size: 20, lineHeight: 1.5, ...over });

describe('text layout', () => {
  it('inline styling splits into runs; unknown tags stay as written', () => {
    const runs = parseRich('Hello [b]bold [c=$accent]red[/c][/b] and [x]this[/x]');
    expect(runs.map((r) => r.text)).toEqual(['Hello ', 'bold ', 'red', ' and [x]this[/x]']);
    expect(runs[1]!.style.bold).toBe(true);
    expect(runs[2]!.style.color).toBe('$accent');
    expect(plainText('[i]a[/i]b')).toBe('ab');
  });

  it('wraps at spaces in the box width', () => {
    const l = layoutText('aaaa bbbb cccc', style(), 'X', { w: 100, h: 0, wrap: true, fit: 'none' }, fake);
    // 10px a letter: "aaaa bbbb" is 90, plus " cccc" would be 140.
    expect(l.lines.map((x) => x.glyphs.map((g) => g.ch).join(''))).toEqual(['aaaa bbbb', 'cccc']);
    expect(l.counts).toEqual({ char: 12, word: 3, line: 2 });
    expect(l.overflow).toBe(false);
  });

  it('keeps new lines and breaks words longer than the box', () => {
    const l = layoutText('ab\ncdefghijklmnop', style(), 'X', { w: 60, h: 0, wrap: true, fit: 'none' }, fake);
    expect(l.lines.map((x) => x.glyphs.map((g) => g.ch).join(''))).toEqual(['ab', 'cdefgh', 'ijklmn', 'op']);
  });

  it('shrinks to fit the box, down to the smallest size allowed', () => {
    const box = { w: 200, h: 30, wrap: false, fit: 'shrink' as const, minSize: 5 };
    const l = layoutText('a much longer line of words', style(), 'X', box, fake);
    expect(l.size).toBeLessThan(20);
    expect(l.overflow).toBe(false);
    expect(l.width).toBeLessThanOrEqual(200.5);
    // It is the largest size that fits (a little bigger would not).
    expect(l.size * 1.05 * 0.5 * 27).toBeGreaterThan(200 - 1);
    const tooSmall = layoutText('a much longer line of words', style(), 'X', { ...box, minSize: 18 }, fake);
    expect(tooSmall.size).toBe(18);
    expect(tooSmall.overflow).toBe(true);
  });

  it('aligns lines and places them in the box', () => {
    const l = layoutText('ab\nabcd', style({ align: 'center', vAlign: 'top' }), 'X', { w: 100, h: 200, wrap: true, fit: 'none' }, fake);
    expect(l.lines[0]!.x).toBe(40);
    expect(l.lines[1]!.x).toBe(30);
    expect(l.lines[1]!.y - l.lines[0]!.y).toBe(30);
    const r = layoutText('ab', style({ align: 'right' }), 'X', { w: 100, h: 0, wrap: true, fit: 'none' }, fake);
    expect(r.lines[0]!.x).toBe(80);
  });

  it('capitals, tracking and a line limit with an ellipsis', () => {
    const caps = layoutText('ab', style({ caps: true, tracking: 2 }), 'X', { w: 0, h: 0, wrap: false, fit: 'none' }, fake);
    expect(caps.lines[0]!.glyphs.map((g) => g.ch).join('')).toBe('AB');
    expect(caps.width).toBe(14 + 14 + 4);
    const cut = layoutText('aa bb cc dd', style(), 'X', { w: 30, h: 0, wrap: true, fit: 'none', maxLines: 2 }, fake);
    expect(cut.lines.length).toBe(2);
    expect(cut.lines[1]!.glyphs.map((g) => g.ch).join('')).toBe('bb…');
  });
});

describe('text animators', () => {
  const a = (over: Partial<TextAnimator>): TextAnimator => ({
    id: 'a',
    name: 'a',
    by: 'char',
    start: { v: 0 },
    end: { v: 100 },
    offset: { v: 0 },
    shape: 'square',
    ...over,
  });
  it('a square range selects whole units and parts of units at its edge', () => {
    expect(selection(a({ start: { v: 50 } }), 0, 4, 0)).toBe(0);
    expect(selection(a({ start: { v: 50 } }), 3, 4, 0)).toBe(1);
    expect(selection(a({ start: { v: 37.5 } }), 1, 4, 0)).toBeCloseTo(0.5);
    expect(selection(a({ start: { v: 37.5 }, reverse: true }), 2, 4, 0)).toBeCloseTo(0.5);
  });
  it('the offset moves the range; ramps fall off', () => {
    expect(selection(a({ end: { v: 25 }, offset: { v: 50 } }), 2, 4, 0)).toBe(1);
    expect(selection(a({ shape: 'rampUp' }), 0, 4, 0)).toBeCloseTo(0.125);
    expect(selection(a({ shape: 'triangle' }), 1, 4, 0)).toBeCloseTo(0.75);
  });
});

describe('data binding and brand tokens', () => {
  const p = newProject();
  p.variables = [
    { key: 'name', label: 'Name', type: 'text', value: 'Sample' },
    { key: 'score', label: 'Score', type: 'number', value: '3', decimals: 1, suffix: ' pts' },
    { key: 'items', label: 'Items', type: 'list', value: 'a\nb', separator: ' · ' },
    { key: 'team', label: 'Team color', type: 'color', value: '#00ff00' },
  ];
  it('fills {{fields}} with values, sample values first', () => {
    const values = valuesFor(p, { name: 'Jordan' });
    expect(fill('Hi {{name}} {{ score }} {{items}} {{nope}}', values, p.variables)).toBe('Hi Jordan 3.0 pts a · b {{nope}}');
    expect(variablesIn('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
    expect(formatValue(undefined, 'x')).toBe('x');
    expect(formatValue(p.variables[1], 'n/a')).toBe('n/a pts');
  });
  it('resolves colors from tokens and fields; bad colors fall back', () => {
    const tokens = tokensFor(p, { accent: '#123456' });
    const values = valuesFor(p, undefined);
    expect(resolveColor('$accent', tokens, values)).toBe('#123456');
    expect(resolveColor('$box', tokens, values)).toBe(DEFAULT_TOKENS.box);
    expect(resolveColor('{{team}}', tokens, values)).toBe('#00ff00');
    expect(resolveColor('{{name}}', tokens, values, '#abcdef')).toBe('#abcdef');
    expect(resolveColor('javascript:alert(1)', tokens, values, '#000000')).toBe('#000000');
  });
  it('picks readable text and lists the fields a project uses', () => {
    expect(readableOn('#ffffff')).toBe('#111111');
    expect(readableOn('#101010')).toBe('#ffffff');
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    const c = p.compositions[0]!;
    c.layers = [newText(c, '{{name}} — {{role}}'), newShape(c, 'rect', [0, 0], [10, 10], '{{team}}')];
    expect(usedVariables(p)).toEqual(['name', 'role', 'team']);
    expect(keyFrom('Score — Home!')).toBe('score_home');
  });
});

describe('format: reading, repairing and moving up older files', () => {
  it('reads every starter template unchanged', () => {
    for (const t of starterTemplates()) {
      const r = readProject(JSON.parse(JSON.stringify(t)));
      expect(r.error).toBeNull();
      expect(r.notes).toEqual([]);
      expect(r.project).toEqual(JSON.parse(JSON.stringify(t)));
    }
  });

  it('has 20+ templates in every category, each with its fields used', () => {
    const all = starterTemplates();
    expect(all.length).toBeGreaterThanOrEqual(20);
    for (const cat of CATEGORIES) expect(all.some((t) => t.category === cat)).toBe(true);
    for (const t of all) {
      const used = usedVariables(t);
      for (const v of t.variables) expect(used, `${t.name}: ${v.key}`).toContain(v.key);
      expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
      expect(fromTemplate(t).id).not.toBe(t.id);
    }
  });

  it('templates use brand tokens, never fixed colors (except team colors from fields)', () => {
    for (const t of starterTemplates()) {
      const json = JSON.stringify(t.compositions);
      const fixed = json.match(/"color":"#[0-9a-f]+"/gi) ?? [];
      expect(fixed, t.name).toEqual([]);
      expect(json).not.toMatch(/"type":"(linear|radial)"/);
      expect(json).not.toMatch(/"glow"/);
    }
  });

  it('refuses what it cannot read, with a reason', () => {
    expect(parseProject('{nope').error).toMatch(/not valid JSON/);
    expect(readProject({ format: 'other' }).error).toMatch(/not a Lumora Titler file/);
    expect(readProject({ format: 'lumora-title', version: 99 }).error).toMatch(/newer/);
    expect(readProject({ format: 'lumora-title', version: 2, compositions: [] }).error).toMatch(/no compositions/);
  });

  it('moves a version 1 file up', () => {
    const v1 = {
      format: 'lumora-title',
      version: 1,
      name: 'Old one',
      width: 1280,
      height: 720,
      duration: 5,
      inEnd: 0.8,
      outStart: 4.5,
      fields: [{ key: 'name', label: 'Name', sample: 'Sam' }],
      layers: [newText(null, '{{name}}')],
    };
    const r = readProject(v1);
    expect(r.error).toBeNull();
    const p = r.project!;
    expect(p.version).toBe(2);
    expect(p.compositions[0]).toMatchObject({ width: 1280, height: 720, duration: 5, markers: { inEnd: 0.8, outStart: 4.5 } });
    expect(p.variables).toEqual([{ key: 'name', label: 'Name', type: 'text', value: 'Sam' }]);
    expect(r.notes[0]).toMatch(/version 1/);
  });

  it('repairs broken parts and says what it did', () => {
    const p = newProject();
    const c = p.compositions[0]!;
    const a = newText(c, 'A');
    const b = newText(c, 'B');
    b.id = a.id;
    a.parent = 'missing';
    const raw = JSON.parse(JSON.stringify(p));
    raw.compositions[0].layers = [a, b, { type: 'sparkles' }, { ...newShape(c), transform: { position: { v: ['x', 1] } } }];
    raw.compositions[0].markers = { inEnd: 5, outStart: 1 };
    raw.variables = [{ key: 'bad key!' }, { key: 'ok', value: 3 }];
    const r = readProject(raw);
    expect(r.error).toBeNull();
    const layers = r.project!.compositions[0]!.layers;
    expect(layers.length).toBe(3);
    expect(new Set(layers.map((l) => l.id)).size).toBe(3);
    expect(layers[0]!.parent).toBeNull();
    expect(layers[2]!.transform.position).toEqual({ v: [0, 0] });
    expect(r.project!.compositions[0]!.markers.outStart).toBeGreaterThanOrEqual(r.project!.compositions[0]!.markers.inEnd);
    expect(r.project!.variables).toEqual([{ key: 'ok', label: 'ok', type: 'text', value: '3' }]);
    expect(r.notes.join(' ')).toMatch(/unknown kind/);
    expect(r.notes.join(' ')).toMatch(/parent was not found/);
  });

  it('breaks a loop of parents', () => {
    const p = newProject();
    const c = p.compositions[0]!;
    const a = newText(c, 'A');
    const b = newText(c, 'B');
    a.parent = b.id;
    b.parent = a.id;
    c.layers = [a, b];
    const r = readProject(JSON.parse(JSON.stringify(p)));
    expect(r.project!.compositions[0]!.layers.some((l) => !l.parent)).toBe(true);
  });
});

describe('packages (.lumtitle)', () => {
  it('puts linked pictures inside and reads back the same project', async () => {
    const p = newProject('My: title?');
    p.assets = [
      { id: 'a1', name: 'logo', kind: 'image', src: 'C:/logos/logo.png' },
      { id: 'a2', name: 'in', kind: 'image', src: 'data:image/png;base64,AAAA' },
    ];
    const text = await pack(p, async (src) => (src.endsWith('.png') ? 'data:image/png;base64,QUJD' : null));
    const back = unpack(text);
    expect(back.error).toBeNull();
    expect(back.project!.assets.map((a) => a.src)).toEqual(['data:image/png;base64,QUJD', 'data:image/png;base64,AAAA']);
    expect(back.project!.compositions).toEqual(p.compositions);
    expect(fileName(p)).toBe('My title.lumtitle');
  });
});

describe('paths and parenting', () => {
  it('rectangles, rounded corners and ellipses have the right bounds', () => {
    expect(pathBounds(rectPath(100, 50, 0))).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    const r = pathBounds(rectPath(100, 50, 10));
    expect(r.w).toBeCloseTo(100);
    const e = pathBounds(ellipsePath(80, 40));
    expect(e.w).toBeCloseTo(80, 0);
    expect(e.h).toBeCloseTo(40, 0);
    expect(svgPathD(rectPath(10, 10, 0))).toBe('M0 0 C0 0 10 0 10 0 C10 0 10 10 10 10 C10 10 0 10 0 10 C0 10 0 0 0 0 Z');
    expect(flatten({ closed: false, v: [{ p: [0, 0] }, { p: [10, 0] }] })).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it('trims a path to part of its length', () => {
    const pts: number[][] = [];
    const sink = {
      moveTo: (x: number, y: number) => pts.push([x, y]),
      lineTo: (x: number, y: number) => pts.push([x, y]),
      bezierCurveTo: () => {},
      closePath: () => {},
    };
    traceTrimmed(sink, { closed: false, v: [{ p: [0, 0] }, { p: [100, 0] }] }, 25, 75, 0);
    expect(pts[0]).toEqual([25, 0]);
    expect(pts[pts.length - 1]).toEqual([75, 0]);
  });

  it('a child moves with its parent', () => {
    const c = newComposition();
    const parent = newShape(c, 'rect', [100, 100]);
    const child = newShape(c, 'rect', [10, 0]);
    child.parent = parent.id;
    parent.transform.rotation = { v: 90 };
    c.layers = [child, parent];
    const m = worldMatrix(c, child, 0);
    const p = apply(m, [0, 0]);
    expect(p[0]).toBeCloseTo(100);
    expect(p[1]).toBeCloseTo(110);
  });

  it('copies of layers get new ids and keep their links among themselves', () => {
    const c = newComposition();
    const a = newShape(c);
    const b = newText(c, 'x');
    b.parent = a.id;
    b.matte = { layer: a.id, mode: 'alpha' };
    const [a2, b2] = cloneLayers([a, b]);
    expect(a2!.id).not.toBe(a.id);
    expect(b2!.parent).toBe(a2!.id);
    expect(b2!.matte!.layer).toBe(a2!.id);
  });
});
