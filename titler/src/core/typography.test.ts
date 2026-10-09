// Typography: tabular figures, kerning on or off, small capitals, justified
// lines, baseline shift, and text styles shared across a title.

import { describe, expect, it } from 'vitest';
import { addLayers } from '../designer/ops';
import { applyTextStyle, differsFromStyle, newTextStyle, removeTextStyle, styleFromLayer, updateTextStyle } from '../designer/textStyles';
import { newComposition, newProject, newText, textStyle } from './build';
import { layoutText, parseRich, type Measure } from './layout';
import type { TextLayer, TextStyle } from './types';

/** A font where "1" is narrow, other digits 10 px, letters 12 px, lowercase 9 px, and "AV" kerns by −3 px. */
const measure: Measure = (font, text) => {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 40) / 40;
  let w = 0;
  const chars = [...text];
  chars.forEach((ch, i) => {
    w += ch === '1' ? 4 : /\d/.test(ch) ? 10 : ch === ' ' ? 5 : /[a-z]/.test(ch) ? 9 : 12;
    if (ch === 'V' && chars[i - 1] === 'A') w -= 3;
  });
  return w * px;
};

const st = (over: Partial<TextStyle> = {}): TextStyle => textStyle({ size: 40, tracking: 0, ...over });
const box = { w: 0, h: 0, wrap: false, fit: 'none' as const };

describe('typography', () => {
  it('tabular figures: every digit as wide as the widest, the narrow ones centered', () => {
    const prop = layoutText('11:00', st(), 'Test', box, measure);
    const tab = layoutText('11:00', st({ figures: 'tabular' }), 'Test', box, measure);
    expect(prop.width).toBe(4 + 4 + 12 + 10 + 10);
    expect(tab.width).toBe(10 + 10 + 12 + 10 + 10);
    const one = tab.lines[0]!.glyphs[0]!;
    expect(one.w).toBe(10);
    expect(one.ox).toBe(3);
    // "11" and "88" take the same room: a clock doesn't jiggle.
    expect(layoutText('18:88', st({ figures: 'tabular' }), 'Test', box, measure).width).toBe(tab.width);
  });

  it('kerning: the font’s pairs, or none', () => {
    expect(layoutText('AV', st(), 'Test', box, measure).width).toBe(21);
    expect(layoutText('AV', st({ kerning: 'none' }), 'Test', box, measure).width).toBe(24);
  });

  it('small capitals: lowercase letters become smaller capitals', () => {
    const l = layoutText('Ab', st({ smallCaps: true }), 'Test', box, measure);
    const [a, b] = l.lines[0]!.glyphs;
    expect(a!.ch).toBe('A');
    expect(b!.ch).toBe('B');
    expect(b!.style.scale).toBeCloseTo(78);
    expect(a!.style.scale).toBe(100);
  });

  it('justified: wrapped lines fill the box, the last line of a paragraph does not', () => {
    const l = layoutText('AAA AA AAAA AA AAA', st({ align: 'justify' }), 'Test', { w: 120, h: 0, wrap: true, fit: 'none' }, measure);
    expect(l.lines.length).toBeGreaterThan(1);
    for (const line of l.lines.slice(0, -1)) {
      expect(line.width).toBeCloseTo(120, 5);
      const last = line.glyphs[line.glyphs.length - 1]!;
      expect(last.x + last.w).toBeCloseTo(120, 5);
    }
    expect(l.lines[l.lines.length - 1]!.width).toBeLessThan(120);
  });

  it('baseline shift inside the words', () => {
    const runs = parseRich('H[v=30]2[/v]O [v=-20]low[/v]');
    expect(runs.map((r) => [r.text, r.style.shift])).toEqual([
      ['H', 0],
      ['2', 30],
      ['O ', 0],
      ['low', -20],
    ]);
  });
});

describe('text styles shared across a title', () => {
  function scene() {
    let p = newProject();
    const inner = newComposition('Inner');
    p = { ...p, compositions: [...p.compositions, inner] };
    const a = newText(p.compositions[0]!, 'Name');
    const b = newText(p.compositions[0]!, 'Role');
    const c = newText(inner, 'Other');
    p = addLayers(addLayers(p, p.main, [a, b]), inner.id, [c]);
    return { p, a: a.id, b: b.id, c: c.id };
  }
  const text = (p: ReturnType<typeof newProject>, id: string) => {
    for (const comp of p.compositions) for (const l of comp.layers) if (l.id === id) return l as TextLayer;
    throw new Error(id);
  };

  it('a style made from one text is applied to others, in any composition; changing it changes them all', () => {
    let { p, a, b, c } = scene();
    p = newTextStyle(p, a, 'Headline').project;
    const id = p.textStyles![0]!.id;
    expect(text(p, a).styleRef).toBe(id);
    p = applyTextStyle(p, [b, c], id);
    expect(text(p, c).style).toEqual(text(p, a).style);
    p = updateTextStyle(p, id, { ...p.textStyles![0]!.style, size: 99, weight: 800 });
    for (const x of [a, b, c]) expect(text(p, x).style).toMatchObject({ size: 99, weight: 800 });
  });

  it('a text changed by hand shows it, keeps its look when the style changes, and can update the style or be reset', () => {
    let { p, a, b } = scene();
    p = newTextStyle(p, a, 'Headline').project;
    const id = p.textStyles![0]!.id;
    p = applyTextStyle(p, [b], id);
    p = {
      ...p,
      compositions: p.compositions.map((comp) => ({
        ...comp,
        layers: comp.layers.map((l) => (l.id === b && l.type === 'text' ? { ...l, style: { ...l.style, italic: true } } : l)),
      })),
    };
    expect(differsFromStyle(p, text(p, b))).toBe(true);
    expect(differsFromStyle(p, text(p, a))).toBe(false);
    p = updateTextStyle(p, id, { ...p.textStyles![0]!.style, size: 70 });
    expect(text(p, a).style.size).toBe(70);
    expect(text(p, b).style.italic).toBe(true);
    // "Update style": the style takes b's look; a follows.
    p = styleFromLayer(p, text(p, b));
    expect(text(p, a).style.italic).toBe(true);
    // Removing the style keeps each text's look.
    p = removeTextStyle(p, id);
    expect(text(p, a).styleRef).toBeNull();
    expect(text(p, a).style.italic).toBe(true);
  });
});
