import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/layout.ts'
s=open(p).read()
s+='''
/**
 * Character styles: [cs=Name]words[/cs] takes the font, weight, slant, color
 * and size of the shared text style called Name, as inline tags (the size
 * relative to the text's own). Unknown names stay as written.
 */
export function expandCharStyles(text: string, styles: { name: string; style: TextStyle }[] | undefined, size: number): string {
  if (!styles?.length || !text.includes('[cs=')) return text;
  const stack: string[] = [];
  return text.replace(/\\[cs=([^\\]]{1,60})\\]|\\[\\/cs\\]/g, (whole, name: string | undefined) => {
    if (name === undefined) return stack.pop() ?? '';
    const def = styles.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!def) {
      stack.push('');
      return whole;
    }
    const st = def.style;
    let open = '';
    let close = '';
    const add = (o: string, c: string) => {
      open += o;
      close = c + close;
    };
    add(`[f=${st.font}]`, '[/f]');
    if (st.weight >= 600) add('[b]', '[/b]');
    if (st.italic) add('[i]', '[/i]');
    if (st.fill.type === 'solid') add(`[c=${st.fill.color}]`, '[/c]');
    if (size > 0 && Math.abs(st.size - size) > 0.5) add(`[s=${Math.round((st.size / size) * 100)}]`, '[/s]');
    stack.push(close);
    return open;
  });
}
'''
open(p,'w').write(s)
p='titler/src/core/render.ts'
rep(p,"""export function textLayout(l: TextLayer, values: Values, tokens: BrandTokens, measure: Measure, vars?: TitleProject['variables']): TextLayout {
  const text = fill(l.text, values, vars);""","""export function textLayout(
  l: TextLayer,
  values: Values,
  tokens: BrandTokens,
  measure: Measure,
  vars?: TitleProject['variables'],
  styles?: TitleProject['textStyles'],
): TextLayout {
  const text = expandCharStyles(fill(l.text, values, vars), styles, l.style.size);""")
rep(p,"import { layoutText, type Glyph, type Measure, type TextLayout } from './layout';","import { expandCharStyles, layoutText, type Glyph, type Measure, type TextLayout } from './layout';")
s=open(p).read()
s=s.replace("const lay = textLayout(l, f.values, f.tokens, canvasMeasure(ctx), f.project.variables);","const lay = textLayout(l, f.values, f.tokens, canvasMeasure(ctx), f.project.variables, f.project.textStyles);")
s=s.replace("const lay = textLayout(text, s.f.values, s.f.tokens, canvasMeasure(ctx), s.f.project.variables);","const lay = textLayout(text, s.f.values, s.f.tokens, canvasMeasure(ctx), s.f.project.variables, s.f.project.textStyles);")
open(p,'w').write(s)
p='titler/src/designer/Inspector.tsx'
rep(p,"""      <textarea
        className="tt-textarea"
        aria-label="Words"
        autoFocus={editing}""","""      <CharStyleRow store={store} l={l} words={wordsRef} upd={upd} />
      <textarea
        ref={wordsRef}
        className="tt-textarea"
        aria-label="Words"
        autoFocus={editing}""")
rep(p,"""  const missing = variablesIn(l.text).filter((k) => !fieldKeys.includes(k));
  void time;""","""  const missing = variablesIn(l.text).filter((k) => !fieldKeys.includes(k));
  const wordsRef = useRef<HTMLTextAreaElement>(null);
  void time;""")
rep(p,"import { useEffect, useState, type ReactElement } from 'react';","import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';")
s=open(p).read()
s+='''
/** Character styles: the selected words take a shared text style's font, weight, color and size ([cs=Name]…[/cs]). */
function CharStyleRow({ store, l, words, upd }: { store: Store; l: TextLayer; words: RefObject<HTMLTextAreaElement | null>; upd: (label: string, fn: (x: TextLayer) => TextLayer) => void }) {
  const styles = useStore(store, (s) => s.project.textStyles ?? []);
  if (!styles.length) return null;
  const apply = (name: string) => {
    const el = words.current;
    const a = el?.selectionStart ?? 0;
    const b = el?.selectionEnd ?? 0;
    if (!name) {
      // Plain again: the character style tags around the selection (or everywhere when nothing is selected) come off.
      upd('Remove character style', (x) => {
        if (a === b) return { ...x, text: x.text.replace(/\\[cs=[^\\]]{1,60}\\]|\\[\\/cs\\]/g, '') };
        const mid = x.text.slice(a, b).replace(/\\[cs=[^\\]]{1,60}\\]|\\[\\/cs\\]/g, '');
        return { ...x, text: x.text.slice(0, a) + mid + x.text.slice(b) };
      });
      return;
    }
    if (a === b) {
      store.set({ status: 'Select some words in the box below first.' });
      return;
    }
    upd('Character style', (x) => ({ ...x, text: `${x.text.slice(0, a)}[cs=${name}]${x.text.slice(a, b)}[/cs]${x.text.slice(b)}` }));
  };
  return (
    <Row label="Words style" hint="Select words below, then pick a shared style for them (character style)">
      <select className="tt-select" aria-label="Character style for the selected words" value="" onChange={(e) => apply(e.target.value)} onMouseDown={(e) => e.stopPropagation()}>
        <option value="" disabled>
          Style the selected words…
        </option>
        {styles.map((s) => (
          <option key={s.id} value={s.name}>
            {s.name}
          </option>
        ))}
        <option value="">Plain (remove)</option>
      </select>
    </Row>
  );
}
'''
open(p,'w').write(s)
