import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Adjust } from '../engine/types/Adjust';
import type { Effect } from '../engine/types/Effect';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { SourceView } from '../components/SourceView';
import { autoBalance, ChromaKeyer, defaultAdjust, isAdjusted } from '../engine/chroma';
import type { Act } from './act';
import './InputSettings.css';

type Tab = 'colour' | 'crop' | 'effects';
type NumKey = { [K in keyof Adjust]: Adjust[K] extends number ? K : never }[keyof Adjust];
type FxKey = 'blur' | 'vignette' | 'blackWhite' | 'grain';

const sgn = (n: number) => (n > 0 ? `+${n}` : String(n));
const ROWS: Record<'colour' | 'crop', ([string] | [NumKey, string, number, number, number, (n: number) => string])[]> = {
  colour: [
    ['Light'],
    ['exposure', 'Exposure', -3, 3, 0.1, (n) => `${sgn(Number(n.toFixed(1)))} EV`],
    ['brightness', 'Brightness', -100, 100, 1, sgn],
    ['contrast', 'Contrast', -100, 100, 1, sgn],
    ['highlights', 'Highlights', -100, 100, 1, sgn],
    ['shadows', 'Shadows', -100, 100, 1, sgn],
    ['gamma', 'Gamma', 0.5, 2, 0.01, (n) => n.toFixed(2)],
    ['Colour'],
    ['temperature', 'Temperature', 2500, 9000, 50, (n) => `${n} K`],
    ['tint', 'Tint', -100, 100, 1, sgn],
    ['saturation', 'Saturation', -100, 100, 1, sgn],
    ['Detail'],
    ['sharpness', 'Sharpness', 0, 100, 1, String],
  ],
  crop: [
    ['Crop'],
    ['cropLeft', 'Left', 0, 45, 0.5, (n) => `${n}%`],
    ['cropRight', 'Right', 0, 45, 0.5, (n) => `${n}%`],
    ['cropTop', 'Top', 0, 45, 0.5, (n) => `${n}%`],
    ['cropBottom', 'Bottom', 0, 45, 0.5, (n) => `${n}%`],
    ['Position'],
    ['zoom', 'Zoom', 100, 400, 1, (n) => `${n}%`],
    ['panX', 'Move left / right', -100, 100, 1, sgn],
    ['panY', 'Move up / down', -100, 100, 1, sgn],
    ['rotate', 'Rotate', -180, 180, 0.5, (n) => `${n}°`],
  ],
};
const EFFECTS: [FxKey, string, string][] = [
  ['blur', 'Blur', 'Amount'],
  ['vignette', 'Vignette (dark edges)', 'Strength'],
  ['blackWhite', 'Black & white', 'Amount'],
  ['grain', 'Film grain', 'Amount'],
];

/** One-click looks (light and colour only; crop and position stay). */
const LOOKS: [string, Partial<Adjust>][] = [
  ['Neutral', {}],
  ['Warm stage', { temperature: 6600, saturation: 8, contrast: 6 }],
  ['Cool daylight', { temperature: 4700, tint: -4, contrast: 4 }],
  ['High contrast', { contrast: 30, shadows: -10, highlights: 8, saturation: 12 }],
  ['Soft skin', { contrast: -8, highlights: -10, shadows: 10, sharpness: 0, temperature: 5900, saturation: -4 }],
  ['Black & white', { saturation: -100, contrast: 15 }],
];
const LOOK_KEYS: NumKey[] = ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'gamma', 'temperature', 'tint', 'saturation', 'sharpness'];

const PICTURE = ['camera', 'video', 'image'];

/**
 * Input settings: light and colour, crop and position, and effects for a
 * camera, video or picture. Everything applies live, wherever the input is
 * shown and in the recording.
 */
export function InputSettings({
  show,
  source,
  act,
  client,
  onSwitch,
  onClose,
}: {
  show: Show;
  source: Source;
  act: Act;
  client: EngineClient;
  onSwitch: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('colour');
  const [compare, setCompare] = useState<'after' | 'split' | 'before'>('split');
  const [hist, setHist] = useState<number[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const a = source.adjust;
  const latest = useRef(a);
  latest.current = a;
  const set = (p: Partial<Adjust>) => act({ type: 'updateSource', id: source.id, patch: { adjust: { ...latest.current, ...p } } });
  const d = defaultAdjust();

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // The picture as the processor sees it (the hidden original inside the preview).
  const original = () => {
    const el = stage.current?.querySelector('.is__after video, .is__after img');
    return el instanceof HTMLVideoElement || el instanceof HTMLImageElement ? el : null;
  };
  // Histogram of the adjusted picture, a few times a second.
  useEffect(() => {
    const keyer = new ChromaKeyer();
    const small = document.createElement('canvas');
    small.width = 64;
    small.height = 36;
    const g = small.getContext('2d', { willReadFrequently: true });
    const id = setInterval(() => {
      const el = original();
      if (!el || !g || !keyer.works) return;
      const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
      const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
      if (!w || !h || !keyer.draw(el, w, h, { ...source.key, enabled: false }, latest.current, 320)) return;
      g.clearRect(0, 0, 64, 36);
      g.drawImage(keyer.canvas, 0, 0, 64, 36);
      const px = g.getImageData(0, 0, 64, 36).data;
      const bins = new Array<number>(32).fill(0);
      for (let i = 0; i < px.length; i += 4) bins[Math.min(31, Math.floor((0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 8))]! += 1;
      const max = Math.max(1, ...bins);
      setHist(bins.map((b) => b / max));
    }, 400);
    return () => clearInterval(id);
  }, [source.id, source.key]);

  const autoWb = () => {
    const el = original();
    if (!el) return;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    try {
      g.drawImage(el, 0, 0, 32, 18);
      const px = g.getImageData(0, 0, 32, 18).data;
      let r = 0;
      let gr = 0;
      let b = 0;
      for (let i = 0; i < px.length; i += 4) {
        r += px[i]!;
        gr += px[i + 1]!;
        b += px[i + 2]!;
      }
      set(autoBalance([r, gr, b]));
    } catch {
      /* the picture can't be read here */
    }
  };

  const slider = (key: NumKey, label: string, min: number, max: number, step: number, fmt: (n: number) => string) => {
    const v = a[key];
    const changed = v !== d[key];
    return (
      <div key={key} className="is__row">
        <span>{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          aria-label={label}
          onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<Adjust>)}
        />
        <em className={changed ? 'is-changed' : undefined}>{fmt(v)}</em>
        <button
          type="button"
          className="is__reset"
          aria-label={`Reset ${label}`}
          title="Reset"
          disabled={!changed}
          onClick={() => set({ [key]: d[key] } as Partial<Adjust>)}
        >
          ↺
        </button>
      </div>
    );
  };
  const rows = (list: (typeof ROWS)['colour']) =>
    list.map((r) =>
      r.length === 1 ? (
        <span key={r[0]} className="is__head">
          {r[0]}
        </span>
      ) : (
        slider(...r)
      ),
    );
  const lookOn = (p: Partial<Adjust>) => LOOK_KEYS.every((k) => a[k] === (p[k] ?? d[k]));
  const choices = show.sources.filter((s) => PICTURE.includes(s.kind.type));
  const plain: Source = { ...source, adjust: defaultAdjust() };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Input settings" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box is">
        <header className="modal__head">
          <h2>Input settings — {source.name}</h2>
          <span className="remote__spacer" />
          <select value={source.id} onChange={(e) => onSwitch(e.target.value)} aria-label="Switch input">
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="is__body">
          <section className="is__left">
            <div className="is__bar">
              <span className="is__label">PREVIEW</span>
              <span className="field__note">Changes apply live</span>
              <span className="remote__spacer" />
              <div className="segs" role="group" aria-label="Compare">
                {(
                  [
                    ['after', 'After only'],
                    ['split', 'Split'],
                    ['before', 'Before only'],
                  ] as const
                ).map(([id, name]) => (
                  <button key={id} type="button" className="seg" aria-pressed={compare === id} onClick={() => setCompare(id)}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div ref={stage} className="is__stage">
              <div className="is__after" style={compare === 'before' ? { visibility: 'hidden' } : undefined}>
                <SourceView source={source} client={client} report={false} />
              </div>
              {compare !== 'after' && (
                <div className="is__before" style={compare === 'split' ? { clipPath: 'inset(0 50% 0 0)' } : undefined}>
                  <SourceView source={plain} client={client} report={false} />
                </div>
              )}
              {compare === 'split' && <div className="is__line" />}
              {compare !== 'after' && <span className="is__tag is__tag--l">Before</span>}
              {compare !== 'before' && <span className="is__tag is__tag--r">After</span>}
            </div>
            <div className="is__under">
              <div className="is__looks">
                <span className="is__label">LOOKS</span>
                <div className="is__lookrow">
                  {LOOKS.map(([name, p]) => (
                    <button
                      key={name}
                      type="button"
                      className={`is__look${lookOn(p) ? ' is-on' : ''}`}
                      onClick={() => set({ ...Object.fromEntries(LOOK_KEYS.map((k) => [k, d[k]])), ...p })}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="is__hist" aria-label="Histogram" title="How much of the picture is dark (left) to bright (right)">
                {hist.map((h, i) => (
                  <i key={i} style={{ height: `${Math.max(2, h * 100)}%` }} />
                ))}
              </div>
            </div>
          </section>
          <section className="is__right">
            <div className="is__tabs" role="tablist">
              {(
                [
                  ['colour', 'Colour & light'],
                  ['crop', 'Crop & position'],
                  ['effects', 'Effects'],
                ] as const
              ).map(([id, name]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`is__tab${tab === id ? ' is-on' : ''}`}
                  onClick={() => setTab(id)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="is__props">
              {tab === 'colour' && (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={autoWb}
                    title="Makes the average of the picture neutral: point the camera at something white or grey first"
                  >
                    Auto white balance
                  </button>
                  {rows(ROWS.colour)}
                </>
              )}
              {tab === 'crop' && (
                <>
                  {rows(ROWS.crop)}
                  <div className="is__flip">
                    <span>Flip</span>
                    <button type="button" className={`btn${a.flipH ? ' is-on' : ''}`} onClick={() => set({ flipH: !a.flipH })}>
                      ⇋ Mirror
                    </button>
                    <button type="button" className={`btn${a.flipV ? ' is-on' : ''}`} onClick={() => set({ flipV: !a.flipV })}>
                      ⇵ Upside down
                    </button>
                  </div>
                  <div className="is__flip">
                    <span>Picture</span>
                    <div className="segs">
                      <button
                        type="button"
                        className="seg"
                        aria-pressed={source.fit === 'cover'}
                        onClick={() => act({ type: 'updateSource', id: source.id, patch: { fit: 'cover' } })}
                      >
                        Fill the screen
                      </button>
                      <button
                        type="button"
                        className="seg"
                        aria-pressed={source.fit === 'contain'}
                        onClick={() => act({ type: 'updateSource', id: source.id, patch: { fit: 'contain' } })}
                      >
                        Show all of it
                      </button>
                    </div>
                  </div>
                  {source.kind.type === 'camera' && (
                    <div
                      className="is__row"
                      title="When the sound arrives later than the picture (a sound desk, wireless microphones), hold the picture back to match"
                    >
                      <span>Picture delay</span>
                      <input
                        type="range"
                        min={0}
                        max={1000}
                        step={10}
                        value={source.videoDelayMs ?? 0}
                        aria-label="Picture delay"
                        onChange={(e) => act({ type: 'updateSource', id: source.id, patch: { videoDelayMs: Number(e.target.value) } })}
                      />
                      <em className={source.videoDelayMs ? 'is-changed' : undefined}>{source.videoDelayMs ?? 0} ms</em>
                      <button
                        type="button"
                        className="is__reset"
                        aria-label="Reset Picture delay"
                        title="Reset"
                        disabled={!source.videoDelayMs}
                        onClick={() => act({ type: 'updateSource', id: source.id, patch: { videoDelayMs: 0 } })}
                      >
                        ↺
                      </button>
                    </div>
                  )}
                </>
              )}
              {tab === 'effects' && (
                <>
                  {EFFECTS.map(([key, name, amountLabel]) => {
                    const fx: Effect = a[key];
                    return (
                      <div key={key} className={`is__fx${fx.on ? ' is-on' : ''}`}>
                        <label className="check">
                          <input type="checkbox" checked={fx.on} onChange={(e) => set({ [key]: { ...fx, on: e.target.checked } } as Partial<Adjust>)} /> {name}
                        </label>
                        <div className="is__row">
                          <span>{amountLabel}</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={fx.amount}
                            aria-label={`${name} amount`}
                            onChange={(e) => set({ [key]: { on: true, amount: Number(e.target.value) } } as Partial<Adjust>)}
                          />
                          <em>{Math.round(fx.amount)}</em>
                        </div>
                      </div>
                    );
                  })}
                  <p className="field__note">Effects apply to this input wherever it is used.</p>
                </>
              )}
            </div>
          </section>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" disabled={!isAdjusted(a)} onClick={() => set(defaultAdjust())}>
            Reset everything
          </button>
          <span className="remote__spacer" />
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
