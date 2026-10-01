import { useEffect, useState } from 'react';
import { EFFECTS } from '../engine/effects';
import type { TextEntrance } from '../engine/types/TextEntrance';
import { FontPicker } from '../components/FontPicker';
import type { Source } from '../engine/types/Source';
import type { TextInput } from '../engine/types/TextInput';
import type { TextStyle } from '../engine/types/TextStyle';
import { ACCENTS, TEXT_DESIGNS, TEXT_FONTS, TEXT_TEMPLATES } from '../engine/text';
import { TextView } from '../components/TextView';
import type { Act } from './act';
import './TextEditor.css';

const WEIGHTS = [
  [300, 'Light'],
  [400, 'Regular'],
  [600, 'Semibold'],
  [700, 'Bold'],
  [900, 'Black'],
] as const;

/** Edit a text input: the words, where they sit, and how they look. Applied on Done. */
export function TextEditor({ source, act, onClose }: { source: Source; act: Act; onClose: () => void }) {
  const start = source.kind.type === 'text' ? source.kind : null;
  const [t, setT] = useState<TextInput>(() => structuredClone({ layout: start!.layout, text: start!.text, sub: start!.sub, style: start!.style }));
  const [behind, setBehind] = useState<'dark' | 'checker' | 'light'>('dark');
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!start) return null;

  const set = (p: Partial<TextInput>) => setT((x) => ({ ...x, ...p }));
  const style = (p: Partial<TextStyle>) => setT((x) => ({ ...x, style: { ...x.style, ...p } }));
  const s = t.style;
  const range = (label: string, key: keyof TextStyle, min: number, max: number, step = 1, show = (v: number) => String(v)) => (
    <label className="field">
      <span className="field__label">
        {label} · {show(s[key] as number)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={s[key] as number}
        onChange={(e) => style({ [key]: Number(e.target.value) })}
        aria-label={label}
      />
    </label>
  );

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Text" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box txed">
        <header className="modal__head">
          <h2>Text · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="txed__body">
          <section className="txed__main">
            <div className={`txed__stage txed__stage--${behind}`}>
              <TextView key={`${replay}:${t.style.design}`} t={t} />
            </div>
            <div className="txed__behind">
              Preview over
              {(
                [
                  ['dark', 'dark'],
                  ['checker', 'see-through'],
                  ['light', 'light'],
                ] as const
              ).map(([id, name]) => (
                <button key={id} type="button" className="seg" aria-pressed={behind === id} onClick={() => setBehind(id)}>
                  {name}
                </button>
              ))}
            </div>
            <span className="field__label">Kind</span>
            <div className="seg-group">
              {TEXT_TEMPLATES.map((x) => (
                <button
                  key={x.layout}
                  type="button"
                  className="seg"
                  aria-pressed={t.layout === x.layout}
                  title={x.hint}
                  onClick={() => set({ layout: x.layout })}
                >
                  {x.name}
                </button>
              ))}
            </div>
            <label className="field">
              <span className="field__label">Text</span>
              <textarea
                className="text txed__words"
                dir="auto"
                rows={2}
                value={t.text}
                maxLength={500}
                onChange={(e) => set({ text: e.target.value })}
                aria-label="Text"
              />
            </label>
            <label className="field">
              <span className="field__label">Second line</span>
              <input
                className="text"
                dir="auto"
                value={t.sub}
                maxLength={500}
                placeholder="(none)"
                onChange={(e) => set({ sub: e.target.value })}
                aria-label="Second line"
              />
            </label>
            <p className="field__note">Tip: a column name in braces, like {'{Name}'}, takes its words from the data file (Text menu → Data file).</p>
          </section>

          <section className="txed__props" aria-label="Style">
            {t.layout !== 'ticker' && (
              <>
                <span className="field__label">Design</span>
                <div className="txed__designs" role="radiogroup" aria-label="Design">
                  {TEXT_DESIGNS.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      role="radio"
                      aria-checked={(s.design ?? 'box') === x.id}
                      className="txed__design"
                      title={x.hint}
                      onClick={() => style({ design: x.id })}
                    >
                      <span className="txed__mini">
                        <TextView t={{ ...t, layout: 'lowerThird', style: { ...s, design: x.id, animate: false, boxOn: true } }} />
                      </span>
                      {x.name}
                    </button>
                  ))}
                </div>
                <div className="txed__row">
                  <span className="field__label">Accent</span>
                  {ACCENTS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="txed__swatch"
                      style={{ background: c }}
                      aria-label={`Accent ${c}`}
                      aria-pressed={s.accent === c}
                      onClick={() => style({ accent: c })}
                    />
                  ))}
                  <input type="color" value={s.accent ?? '#2f80ed'} onChange={(e) => style({ accent: e.target.value })} aria-label="Accent color" />
                </div>
                <div className="txed__row">
                  <label className="check">
                    <input type="checkbox" checked={s.animate ?? false} onChange={(e) => style({ animate: e.target.checked })} /> Animate on
                  </label>
                  {s.animate && (
                    <>
                      <select
                        value={s.entrance ?? 'build'}
                        onChange={(e) => {
                          style({ entrance: e.target.value as TextEntrance });
                          setReplay((n) => n + 1);
                        }}
                        aria-label="How it comes on"
                      >
                        {EFFECTS.map(([v, name]) => (
                          <option key={v} value={v}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn" onClick={() => setReplay((n) => n + 1)}>
                        ↻ Replay
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            <label className="field">
              <span className="field__label">Font</span>
              <FontPicker value={s.font} onChange={(font) => style({ font })} />
            </label>
            {range('Size', 'size', 16, 220)}
            <span className="field__label">Weight</span>
            <div className="seg-group">
              {WEIGHTS.map(([w, name]) => (
                <button key={w} type="button" className="seg" aria-pressed={s.weight === w} onClick={() => style({ weight: w })}>
                  {name}
                </button>
              ))}
            </div>
            <span className="field__label">Align</span>
            <div className="seg-group">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button key={a} type="button" className="seg" aria-pressed={s.align === a} onClick={() => style({ align: a })}>
                  {a === 'left' ? 'Left' : a === 'center' ? 'Center' : 'Right'}
                </button>
              ))}
            </div>
            <div className="txed__row">
              <label className="field">
                <span className="field__label">Color</span>
                <input type="color" value={s.color} onChange={(e) => style({ color: e.target.value })} aria-label="Text color" />
              </label>
              <label className="check">
                <input type="checkbox" checked={s.shadow} onChange={(e) => style({ shadow: e.target.checked })} /> Shadow
              </label>
              <label className="check">
                <input type="checkbox" checked={s.outline > 0} onChange={(e) => style({ outline: e.target.checked ? 3 : 0 })} /> Outline
              </label>
              {s.outline > 0 && (
                <input type="color" value={s.outlineColor} onChange={(e) => style({ outlineColor: e.target.value })} aria-label="Outline color" />
              )}
            </div>
            <div className="txed__row">
              <label className="check">
                <input type="checkbox" checked={s.boxOn} onChange={(e) => style({ boxOn: e.target.checked })} /> Background box
              </label>
              {s.boxOn && <input type="color" value={s.boxColor} onChange={(e) => style({ boxColor: e.target.value })} aria-label="Box color" />}
            </div>
            {s.boxOn && (
              <>
                {range('Box opacity', 'boxOpacity', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
                {range('Padding', 'padding', 0, 80)}
                {range('Corners', 'radius', 0, 40)}
              </>
            )}
            {range('Line spacing', 'lineHeight', 0.8, 2, 0.05, (v) => `${v.toFixed(2)}×`)}
            {range('Letter spacing', 'letterSpacing', -4, 20, 0.5)}
            {t.layout === 'ticker' && range('Scroll speed', 'speed', 40, 600, 10, (v) => `${v} px/s`)}
          </section>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              act({ type: 'updateText', id: source.id, text: t });
              onClose();
            }}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
