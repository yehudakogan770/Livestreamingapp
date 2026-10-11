// Typing on the canvas: a text layer being edited gets a text box right over
// it, in its own font, size, spacing and color, turned with the layer. The
// layer itself is not drawn while it is edited (the words show once, here).
// The whole edit is one undo step; Escape or a click elsewhere ends it.

import { useEffect, useRef } from 'react';
import { resolveColor, resolveFont, tokensFor, valuesFor } from '../core/binding';
import type { TextLayer, Vec2 } from '../core/types';
import { layerCorners } from './geometry';
import { compOf, findLayer, updateLayers } from './ops';
import { useStore, type Store } from './store';
import { lookOf, shownTime } from './Viewport';

export interface ViewXf {
  scale: number;
  ox: number;
  oy: number;
}

/** The plain words a layer's name follows ("Text" until it is typed). */
const nameFrom = (text: string) => text.replace(/\{\{|\}\}|\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30) || 'Text';

export function TextEditOverlay({ store, view }: { store: Store; view: ViewXf }) {
  const s = useStore(store, (x) => x);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = s.editingText;
  const c = compOf(s.project, s.compId);
  const l = id ? findLayer(c, id) : undefined;
  const text = l?.type === 'text' ? l : null;

  // Focus once it opens: everything selected for a new "Text", the caret at the end otherwise.
  useEffect(() => {
    if (!text) return;
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.focus();
      if (text.text === 'Text') el.select();
      else el.setSelectionRange(el.value.length, el.value.length);
    });
    store.begin('Edit text');
    return () => {
      cancelAnimationFrame(raf);
      store.end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!text) return null;
  const look = { ...lookOf(s), t: shownTime(s, performance.now()).t };
  const pts = layerCorners(look, text);
  if (pts.length < 4) return null;
  const P = (p: Vec2): Vec2 => [view.ox + p[0] * view.scale, view.oy + p[1] * view.scale];
  const [a, b, , d] = pts.map(P) as [Vec2, Vec2, Vec2, Vec2];
  const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const h = Math.hypot(d[0] - a[0], d[1] - a[1]);
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  // Screen pixels per layer pixel (the layer's own scale with the view's).
  const boxW = text.box[0] > 0 ? text.box[0] : w / view.scale;
  const k = boxW > 0 ? w / boxW : view.scale;
  const st = text.style;
  const tokens = tokensFor(s.project, s.brand ?? undefined);
  const values = valuesFor(s.project, s.values);
  const color = st.fill.type === 'solid' ? resolveColor(st.fill.color, tokens, values) : resolveColor(st.fill.stops[0]?.color, tokens, values);
  const lines = Math.max(1, text.text.split('\n').length);
  const used = lines * st.size * st.lineHeight * k;
  const pad = st.vAlign === 'middle' ? Math.max(0, (h - used) / 2) : st.vAlign === 'bottom' ? Math.max(0, h - used) : 0;
  const finish = () => store.set({ editingText: null });
  return (
    <textarea
      ref={ref}
      className="tt-text-edit"
      aria-label="Words on the canvas"
      spellCheck={false}
      value={text.text}
      dir={st.rtl ? 'rtl' : 'ltr'}
      style={{
        left: a[0],
        top: a[1],
        width: Math.max(24, w),
        height: Math.max(st.size * st.lineHeight * k, h),
        transform: `rotate(${angle}rad)`,
        paddingTop: pad,
        fontFamily: `"${resolveFont(st.font, tokens)}", system-ui, sans-serif`,
        fontWeight: st.weight,
        fontStyle: st.italic ? 'italic' : 'normal',
        fontSize: st.size * k,
        lineHeight: st.lineHeight,
        letterSpacing: st.tracking * k,
        textAlign: st.align === 'justify' ? 'justify' : st.align,
        textTransform: st.caps ? 'uppercase' : 'none',
        fontVariant: st.smallCaps ? 'small-caps' : 'normal',
        color,
        whiteSpace: text.wrap ? 'pre-wrap' : 'pre',
      }}
      onChange={(e) => {
        const v = e.target.value;
        store.edit('Edit text', (p) =>
          updateLayers(p, s.compId, [text.id], (x) =>
            x.type === 'text'
              ? { ...x, text: v, name: x.name === 'Text' || x.name === nameFrom(x.text) ? nameFrom(v) : x.name }
              : x,
          ),
        );
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          e.stopPropagation();
          finish();
        }
      }}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

/** The project as drawn while a layer is edited on the canvas (that layer left out). */
export function withoutEdited<T extends { project: import('../core/types').TitleProject; compId: string; editingText: string | null }>(s: T) {
  if (!s.editingText) return s.project;
  const l = findLayer(compOf(s.project, s.compId), s.editingText);
  if (l?.type !== 'text') return s.project;
  return updateLayers(s.project, s.compId, [l.id], (x) => ({ ...x, visible: false }) as TextLayer);
}
