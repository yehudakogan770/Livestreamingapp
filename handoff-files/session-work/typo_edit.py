import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')

# ---- types ----
p = 'titler/src/core/types.ts'
s = open(p).read()
s = s.replace("""  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  caps?: boolean;""", """  /** Justify: wrapped lines fill the box's width (the last line of a paragraph stays left). */
  align: 'left' | 'center' | 'right' | 'justify';
  vAlign: 'top' | 'middle' | 'bottom';
  caps?: boolean;
  /** Small capitals: lowercase letters as smaller capitals. */
  smallCaps?: boolean;
  /** Tabular figures: every digit the same width (scores and clocks don't jiggle). */
  figures?: 'proportional' | 'tabular';
  /** The font's own kerning (default), or none (each letter its own width). */
  kerning?: 'auto' | 'none';""")
open(p, 'w').write(s)

# ---- layout ----
p = 'titler/src/core/layout.ts'
s = open(p).read()
s = s.replace("""  /** Percent of the size. */
  scale: number;
  font: string | null;
}""", """  /** Percent of the size. */
  scale: number;
  font: string | null;
  /** Baseline shift, percent of the size (up is positive). */
  shift: number;
}""")
s = s.replace("const PLAIN: RunStyle = { bold: false, italic: false, color: null, scale: 100, font: null };",
              "const PLAIN: RunStyle = { bold: false, italic: false, color: null, scale: 100, font: null, shift: 0 };")
s = s.replace(""" * [c=#ff0000]color[/c] (or [c=$accent]), [s=80]smaller[/s], [f=Font]font[/f].
 * Tags not understood stay as text.
 */""", """ * [c=#ff0000]color[/c] (or [c=$accent]), [s=80]smaller[/s], [f=Font]font[/f],
 * [v=30]raised[/v] (baseline shift, percent of the size; negative lowers).
 * Tags not understood stay as text.
 */""")
s = s.replace("const tag = /\\[(\\/?)(b|i|c|s|f)(?:=([^\\]]{1,60}))?\\]/g;", "const tag = /\\[(\\/?)(b|i|c|s|f|v)(?:=([^\\]]{1,60}))?\\]/g;")
s = s.replace("""      case 'f':
        stack.push({ ...top, font: arg ?? null });
        break;
    }""", """      case 'f':
        stack.push({ ...top, font: arg ?? null });
        break;
      case 'v':
        stack.push({ ...top, shift: Math.min(200, Math.max(-200, Number(arg) || 0)) });
        break;
    }""")
s = s.replace("""  word: number;
  line: number;
}

export interface Line {""", """  word: number;
  line: number;
  /** Drawn this far right of x (a tabular digit centered in its cell). */
  ox?: number;
}

export interface Line {""")

s = s.replace("""/** Lay out the text at one size. */
function layoutAt(runs: Run[], style: TextStyle, family: string, size: number, box: LayoutBox, measure: Measure): TextLayout {
  const toks = tokens(runs, !!style.caps);
  const width = (t: Token) => measure(fontString(style, t.style, size, family), t.text) + style.tracking * [...t.text].length;""", """/** Small capitals: lowercase letters become capitals at 78 % (one derived style per run). */
export function smallCapsRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  const small = new Map<RunStyle, RunStyle>();
  for (const r of runs) {
    for (const part of r.text.split(/([\\p{Ll}]+)/u)) {
      if (!part) continue;
      if (/^\\p{Ll}+$/u.test(part)) {
        let st = small.get(r.style);
        if (!st) small.set(r.style, (st = { ...r.style, scale: r.style.scale * 0.78 }));
        out.push({ text: part.toUpperCase(), style: st });
      } else out.push({ text: part, style: r.style });
    }
  }
  return out;
}

const DIGIT = /^\\p{Nd}$/u;

/**
 * Advances in a font with the text's options: the font's kerning, or each
 * letter alone; tabular figures (every digit as wide as the widest).
 */
export function advancer(style: Pick<TextStyle, 'figures' | 'kerning'>, measure: Measure) {
  const tabular = style.figures === 'tabular';
  const apart = style.kerning === 'none';
  const widest = new Map<string, number>();
  const digit = (font: string) => {
    let w = widest.get(font);
    if (w === undefined) {
      w = 0;
      for (const d of '0123456789') w = Math.max(w, measure(font, d));
      widest.set(font, w);
    }
    return w;
  };
  /** One letter's advance and where it is drawn in it. */
  const one = (font: string, ch: string): { w: number; ox: number } => {
    if (tabular && DIGIT.test(ch)) {
      const own = measure(font, ch);
      const w = digit(font);
      return { w, ox: (w - own) / 2 };
    }
    return { w: measure(font, ch), ox: 0 };
  };
  const width = (font: string, text: string): number => {
    if (!tabular && !apart) return measure(font, text);
    if (apart) {
      let w = 0;
      for (const ch of text) w += one(font, ch).w;
      return w;
    }
    let w = measure(font, text);
    for (const ch of text) if (DIGIT.test(ch)) w += digit(font) - measure(font, ch);
    return w;
  };
  return { width, one, perGlyph: tabular || apart };
}

/** Lay out the text at one size. */
function layoutAt(runs: Run[], style: TextStyle, family: string, size: number, box: LayoutBox, measure: Measure): TextLayout {
  const toks = tokens(style.smallCaps ? smallCapsRuns(runs) : runs, !!style.caps);
  const adv = advancer(style, measure);
  const width = (t: Token) => adv.width(fontString(style, t.style, size, family), t.text) + style.tracking * [...t.text].length;""")

s = s.replace("""  type Raw = Token & { w: number };
  const lines: Raw[][] = [[]];
  let lineW = 0;""", """  type Raw = Token & { w: number };
  const lines: Raw[][] = [[]];
  /** Lines that end because they wrapped (not at a line break or the end): justified. */
  const wrapped = new Set<Raw[]>();
  let lineW = 0;""")
s = s.replace("""    if (lineW + w > limit && cur.some((x) => !x.space)) {
      // Wrap: drop trailing spaces, start a new line.
      while (cur.length && cur[cur.length - 1]!.space) cur.pop();
      lines.push([]);
      lineW = 0;
    }""", """    if (lineW + w > limit && cur.some((x) => !x.space)) {
      // Wrap: drop trailing spaces, start a new line.
      while (cur.length && cur[cur.length - 1]!.space) cur.pop();
      wrapped.add(cur);
      lines.push([]);
      lineW = 0;
    }""")
s = s.replace("""        const pw = measure(fontString(style, t.style, size, family), part + ch) + style.tracking * ([...part].length + 1);""", """        const pw = adv.width(fontString(style, t.style, size, family), part + ch) + style.tracking * ([...part].length + 1);""")
s = s.replace("""  kept.forEach((l, li) => {
    const glyphs: Glyph[] = [];
    let x = 0;
    l.forEach((t, ti) => {
      const font = fontString(style, t.style, size, family);
      const chars = [...t.text];
      let prefix = '';
      chars.forEach((ch, ci) => {
        const before = measure(font, prefix) + style.tracking * ci;
        prefix += ch;
        const after = measure(font, prefix) + style.tracking * (ci + 1);
        glyphs.push({ ch, x: x + before, w: after - before, style: t.style, char: t.space ? -1 : char++, word: t.space ? -1 : word, line: li });
      });""", """  kept.forEach((l, li) => {
    const glyphs: Glyph[] = [];
    let x = 0;
    l.forEach((t, ti) => {
      const font = fontString(style, t.style, size, family);
      const chars = [...t.text];
      let prefix = '';
      chars.forEach((ch, ci) => {
        const before = adv.width(font, prefix) + style.tracking * ci;
        prefix += ch;
        const after = adv.width(font, prefix) + style.tracking * (ci + 1);
        const g: Glyph = { ch, x: x + before, w: after - before, style: t.style, char: t.space ? -1 : char++, word: t.space ? -1 : word, line: li };
        if (adv.perGlyph) {
          const ox = adv.one(font, ch).ox;
          if (ox) g.ox = ox;
        }
        glyphs.push(g);
      });""")
s = s.replace("""    maxW = Math.max(maxW, x);
    out.push({ x: 0, y: 0, width: x, glyphs });
  });
  const height = out.length * lh;
  const boxW = box.w > 0 ? box.w : maxW;""", """    maxW = Math.max(maxW, x);
    out.push({ x: 0, y: 0, width: x, glyphs });
  });
  const height = out.length * lh;
  const boxW = box.w > 0 ? box.w : maxW;
  if (style.align === 'justify' && box.w > 0)
    kept.forEach((raw, i) => {
      // Wrapped lines fill the width: the space is shared between the gaps between words.
      const l = out[i]!;
      if (!wrapped.has(raw) || l.width >= boxW) return;
      const gaps = l.glyphs.filter((g) => g.ch === ' ').length;
      if (!gaps) return;
      const each = (boxW - l.width) / gaps;
      let seen = 0;
      for (const g of l.glyphs) {
        g.x += seen * each;
        if (g.ch === ' ') {
          g.w += each;
          seen++;
        }
      }
      l.width = boxW;
    });""")
s = s.replace("""    l.x = style.align === 'center' ? (boxW - l.width) / 2 : style.align === 'right' ? boxW - l.width : 0;""", """    l.x = style.align === 'center' ? (boxW - l.width) / 2 : style.align === 'right' ? boxW - l.width : style.align === 'justify' && style.rtl ? boxW - l.width : 0;""")
open(p, 'w').write(s)

# ---- render ----
p = 'titler/src/core/render.ts'
s = open(p).read()
s = s.replace("""  function drawLines(ox: number, oy: number) {
    for (const line of lay.lines) {
      if (!animated && !st.rtl && st.tracking === 0) {""", """  // Tabular figures, no kerning and justified lines are placed letter by letter.
  const perGlyph = st.figures === 'tabular' || st.kerning === 'none' || st.align === 'justify';
  const up = (g: Glyph) => (g.style.shift ? (g.style.shift / 100) * lay.size : 0);

  function drawLines(ox: number, oy: number) {
    for (const line of lay.lines) {
      if (!animated && !st.rtl && st.tracking === 0 && !perGlyph) {""")
s = s.replace("""          ctx.font = fontFor(g0);
          const x = ox + line.x + g0.x;
          const y = oy + line.y;
          if (stroke && strokeStyle) strokeIt(text, x, y);""", """          ctx.font = fontFor(g0);
          const x = ox + line.x + g0.x;
          const y = oy + line.y - up(g0);
          if (stroke && strokeStyle) strokeIt(text, x, y);""")
s = s.replace("""        ctx.font = fontFor(g);
        const x = ox + line.x + g.x + (look ? look.dx + look.track : 0);
        const y = oy + line.y + (look ? look.dy : 0);""", """        ctx.font = fontFor(g);
        const x = ox + line.x + g.x + (g.ox ?? 0) + (look ? look.dx + look.track : 0);
        const y = oy + line.y - up(g) + (look ? look.dy : 0);""")
open(p, 'w').write(s)
print('ok')
