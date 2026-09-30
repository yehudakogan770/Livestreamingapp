import { useEffect, useRef, useState } from 'react';
import { FontPicker } from '../components/FontPicker';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import type { Element } from '../engine/types/Element';
import type { ElementKind } from '../engine/types/ElementKind';
import type { Entrance } from '../engine/types/Entrance';
import type { Graphic } from '../engine/types/Graphic';
import { GraphicView } from '../components/GraphicView';
import { fromTemplate, newElement, settleMs, TEMPLATES } from '../engine/graphic';
import { TEXT_FONTS } from '../engine/text';
import type { Act } from './act';
import './LyricsCard.css';
import './GraphicCard.css';

const ENTRANCES: [Entrance, string][] = [
  ['none', 'Just there'],
  ['fade', 'Fade in'],
  ['slideLeft', 'Slide in from the left'],
  ['rise', 'Rise'],
  ['grow', 'Grow'],
];

const round = (n: number) => Math.round(n * 2) / 2;

/** The title designer: put text, boxes and pictures anywhere. */
export function GraphicCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const live = source.kind.type === 'graphic' ? source.kind : null;
  const [g, setG] = useState<Graphic>(() => (live ? structuredClone(live) : { elements: [], nextId: 0 }));
  const [sel, setSel] = useState<number | null>(g.elements.at(-1)?.id ?? null);
  const [playing, setPlaying] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; mode: 'move' | 'size'; x: number; y: number; start: Element } | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!live) return null;
  const save = (next: Graphic) => {
    setG(next);
    act({ type: 'updateGraphic', id: source.id, graphic: next });
  };
  const el = g.elements.find((e) => e.id === sel) ?? null;
  const change = (p: Partial<Element>, commit = true) => {
    if (!el) return;
    const next = { ...g, elements: g.elements.map((e) => (e.id === el.id ? { ...e, ...p } : e)) };
    if (commit) save(next);
    else setG(next);
  };
  const add = (kind: ElementKind) => {
    const id = g.nextId + 1;
    save({ elements: [...g.elements, newElement(kind, id)], nextId: id });
    setSel(id);
  };
  const remove = () => {
    if (!el) return;
    save({ ...g, elements: g.elements.filter((e) => e.id !== el.id) });
    setSel(null);
  };
  const order = (d: 1 | -1) => {
    if (!el) return;
    const i = g.elements.findIndex((e) => e.id === el.id);
    const j = i + d;
    if (j < 0 || j >= g.elements.length) return;
    const list = [...g.elements];
    [list[i], list[j]] = [list[j]!, list[i]!];
    save({ ...g, elements: list });
  };
  const copy = () => {
    if (!el) return;
    const id = g.nextId + 1;
    save({ elements: [...g.elements, { ...el, id, x: el.x + 2, y: el.y + 2 }], nextId: id });
    setSel(id);
  };
  const pickImage = async () => {
    const [f] = await client.pickFiles('image');
    if (f) change({ path: f.path });
  };

  // Dragging: move the element, or (from its corner) change its size, in % of the frame.
  const begin = (id: number, e: React.PointerEvent, mode: 'move' | 'size' = 'move') => {
    e.stopPropagation();
    setSel(id);
    const start = g.elements.find((x) => x.id === id);
    if (!start) return;
    drag.current = { id, mode, x: e.clientX, y: e.clientY, start };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const box = stage.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = ((e.clientX - d.x) / box.width) * 100;
    const dy = ((e.clientY - d.y) / box.height) * 100;
    const s = d.start;
    const p = d.mode === 'move' ? { x: round(s.x + dx), y: round(s.y + dy) } : { w: Math.max(1, round(s.w + dx)), h: Math.max(1, round(s.h + dy)) };
    setG((cur) => ({ ...cur, elements: cur.elements.map((x) => (x.id === d.id ? { ...x, ...p } : x)) }));
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setG((cur) => {
      act({ type: 'updateGraphic', id: source.id, graphic: cur });
      return cur;
    });
  };
  const num = (k: keyof Element, label: string, min: number, max: number, step = 0.5) => (
    <label className="field grc__num">
      <span className="field__label">{label}</span>
      <input
        className="text"
        type="number"
        min={min}
        max={max}
        step={step}
        value={el ? (el[k] as number) : 0}
        onChange={(e) => change({ [k]: Number(e.target.value) } as Partial<Element>)}
      />
    </label>
  );
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Title designer" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box grc">
        <header className="modal__head">
          <h2>Title designer · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="grc__body">
          <section className="grc__left">
            <div className="grc__tools">
              <button type="button" className="btn btn--small" onClick={() => add('text')}>
                + Text
              </button>
              <button type="button" className="btn btn--small" onClick={() => add('box')}>
                + Box
              </button>
              <button type="button" className="btn btn--small" onClick={() => add('image')}>
                + Picture
              </button>
              <select
                className="text grc__tpl"
                value=""
                aria-label="Start from"
                onChange={(e) => {
                  if (e.target.value === '') return;
                  if (g.elements.length && !confirm('Replace this design?')) return;
                  const next = fromTemplate(Number(e.target.value));
                  save(next);
                  setSel(next.elements.at(-1)?.id ?? null);
                }}
              >
                <option value="">Start from a design…</option>
                {TEMPLATES.map((t, i) => (
                  <option key={t.name} value={i}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => {
                  const n = Date.now();
                  setPlaying(n);
                  setTimeout(() => setPlaying((cur) => (cur === n ? 0 : cur)), settleMs(g) + 900);
                }}
              >
                ▶ Show it coming in
              </button>
            </div>
            <div ref={stage} className="grc__stage" onPointerDown={() => setSel(null)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
              {playing ? (
                <GraphicView key={playing} g={g} url={(p) => client.mediaUrl(p)} />
              ) : (
                <>
                  <GraphicView g={g} url={(p) => client.mediaUrl(p)} onPick={(id, e) => begin(id, e)} picked={sel} />
                  {el && (
                    <div
                      className="grc__sel"
                      style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }}
                      onPointerDown={(e) => begin(el.id, e)}
                    >
                      <i className="grc__handle" aria-label="Change the size" onPointerDown={(e) => begin(el.id, e, 'size')} />
                    </div>
                  )}
                </>
              )}
              <i className="grc__guide grc__guide--v" />
              <i className="grc__guide grc__guide--h" />
            </div>
            <p className="field__note">
              Drag to move; drag the corner to change the size. The design sits over whatever is behind it — put it on an overlay button. In text, {'{Column}'}{' '}
              takes words from the data file.
            </p>
          </section>
          <section className="grc__props">
            {!el ? (
              <p className="field__note">Click something on the picture to change it, or add text, a box or a picture.</p>
            ) : (
              <>
                <div className="lyc__bar">
                  <button type="button" className="btn btn--small" onClick={() => order(1)} title="In front of the next one">
                    ▲ Forward
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => order(-1)} title="Behind the one before">
                    ▼ Back
                  </button>
                  <button type="button" className="btn btn--small" onClick={copy}>
                    Copy
                  </button>
                  <button type="button" className="btn btn--small" onClick={remove}>
                    Remove
                  </button>
                </div>
                {el.kind === 'text' && (
                  <>
                    <label className="field">
                      <span className="field__label">Words</span>
                      <textarea
                        className="text"
                        dir="auto"
                        rows={2}
                        value={el.text}
                        onChange={(e) => change({ text: e.target.value }, false)}
                        onBlur={() => save(g)}
                        aria-label="Words"
                      />
                    </label>
                    <div className="grc__row">
                      <label className="field" style={{ flex: 2 }}>
                        <span className="field__label">Font</span>
                        <FontPicker value={el.font} onChange={(font) => change({ font })} />
                      </label>
                      {num('size', 'Size', 0.5, 50)}
                      <label className="field grc__num">
                        <span className="field__label">Weight</span>
                        <select className="text" value={el.weight} onChange={(e) => change({ weight: Number(e.target.value) })}>
                          {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                            <option key={w} value={w}>
                              {w}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="grc__row">
                      {(['left', 'center', 'right'] as const).map((a) => (
                        <button key={a} type="button" className={`btn btn--small${el.align === a ? ' is-on' : ''}`} onClick={() => change({ align: a })}>
                          {a === 'left' ? '⯇ Left' : a === 'center' ? 'Centre' : 'Right ⯈'}
                        </button>
                      ))}
                      <label className="check">
                        <input type="checkbox" checked={el.italic} onChange={(e) => change({ italic: e.target.checked })} /> Italic
                      </label>
                    </div>
                  </>
                )}
                {el.kind === 'image' && (
                  <button type="button" className="btn" onClick={() => void pickImage()}>
                    {el.path ? 'Choose another picture…' : 'Choose the picture…'}
                  </button>
                )}
                <div className="grc__row">
                  {el.kind !== 'image' && (
                    <label className="field grc__num">
                      <span className="field__label">Colour</span>
                      <input type="color" value={el.color} onChange={(e) => change({ color: e.target.value })} aria-label="Colour" />
                    </label>
                  )}
                  <label className="field" style={{ flex: 1 }}>
                    <span className="field__label">See-through</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={el.opacity}
                      onChange={(e) => change({ opacity: Number(e.target.value) })}
                      aria-label="Opacity"
                    />
                  </label>
                  {el.kind === 'box' && num('radius', 'Corners', 0, 50)}
                  <label className="check">
                    <input type="checkbox" checked={el.shadow} onChange={(e) => change({ shadow: e.target.checked })} /> Shadow
                  </label>
                </div>
                <div className="grc__row">
                  {num('x', 'Left %', -50, 150)}
                  {num('y', 'Top %', -50, 150)}
                  {num('w', 'Width %', 0.5, 200)}
                  {num('h', 'Height %', 0.3, 200)}
                </div>
                <div className="grc__row">
                  <label className="field" style={{ flex: 2 }}>
                    <span className="field__label">Comes in</span>
                    <select className="text" value={el.entrance} onChange={(e) => change({ entrance: e.target.value as Entrance })}>
                      {ENTRANCES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  {num('delayMs', 'After (ms)', 0, 10000, 50)}
                </div>
              </>
            )}
            <span className="field__label">Layers (front on top)</span>
            <ol className="grc__layers">
              {[...g.elements].reverse().map((e) => (
                <li key={e.id}>
                  <button type="button" className={e.id === sel ? 'is-on' : ''} onClick={() => setSel(e.id)}>
                    {e.kind === 'text' ? `T  ${e.text.slice(0, 30) || '(no words)'}` : e.kind === 'box' ? '■  Box' : '🖼  Picture'}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
