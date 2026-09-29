import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import type { Split } from '../engine/types/Split';
import type { Frame } from '../engine/types/Frame';
import { SPLIT_LAYOUTS, applyLayout } from '../engine/split';
import { clampFrame } from '../engine/overlays';
import { SourceView } from '../components/SourceView';
import type { Act } from './act';
import './SplitEditor.css';
import './TextEditor.css';

const CAN_GO_IN = ['camera', 'video', 'image', 'color', 'pattern', 'countdown', 'text', 'pesukim', 'credits', 'visuals'];

/** Choose the layout and what goes in each box. */
export function SplitPicker({ split, sources, onChange }: { split: Split; sources: Source[]; onChange: (s: Split) => void }) {
  const choices = sources.filter((s) => CAN_GO_IN.includes(s.kind.type));
  const set = (p: Partial<Split>) => onChange(applyLayout({ ...split, ...p }));
  const setBox = (i: number, sourceId: string | null) => onChange({ ...split, boxes: split.boxes.map((b, j) => (j === i ? { ...b, sourceId } : b)) });
  const setFrame = (i: number, f: Frame) => onChange({ ...split, boxes: split.boxes.map((b, j) => (j === i ? { ...b, frame: clampFrame(f) } : b)) });
  const custom = split.layout === 'custom';
  return (
    <div className="field spl">
      <span className="field__label">Layout</span>
      <div className="addinput__list">
        {SPLIT_LAYOUTS.map((l) => (
          <button key={l.id} type="button" className="seg" aria-pressed={split.layout === l.id} onClick={() => set({ layout: l.id })}>
            {l.name}
          </button>
        ))}
      </div>
      {split.boxes.map((b, i) => (
        <div key={i} className="spl__box">
          <span className="spl__n">{i + 1}</span>
          <select value={b.sourceId ?? ''} onChange={(e) => setBox(i, e.target.value || null)} aria-label={`Box ${i + 1}`}>
            <option value="">(empty)</option>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {custom &&
            (['x', 'y', 'w', 'h'] as const).map((k) => (
              <input
                key={k}
                type="number"
                className="text spl__num"
                value={Math.round(b.frame[k])}
                onChange={(e) => setFrame(i, { ...b.frame, [k]: Number(e.target.value) })}
                aria-label={`Box ${i + 1} ${k}`}
                title={{ x: 'Left %', y: 'Top %', w: 'Width %', h: 'Height %' }[k]}
              />
            ))}
          {custom && split.boxes.length > 1 && (
            <button
              type="button"
              className="icon"
              aria-label={`Remove box ${i + 1}`}
              onClick={() => onChange({ ...split, boxes: split.boxes.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {custom && split.boxes.length < 4 && (
        <button
          type="button"
          className="btn"
          onClick={() => onChange({ ...split, boxes: [...split.boxes, { sourceId: null, frame: { x: 60, y: 10, w: 30, h: 30 } }] })}
        >
          + Add a box
        </button>
      )}
      <div className="txed__row">
        <label className="field">
          <span className="field__label">Space between · {split.gap}%</span>
          <input type="range" min={0} max={8} step={0.5} value={split.gap} onChange={(e) => set({ gap: Number(e.target.value) })} aria-label="Space between" />
        </label>
        <label className="check">
          Background <input type="color" value={split.background} onChange={(e) => set({ background: e.target.value })} aria-label="Background" />
        </label>
        <label className="check">
          <input type="checkbox" checked={split.border} onChange={(e) => set({ border: e.target.checked })} /> Line around each
        </label>
        {split.border && <input type="color" value={split.borderColor} onChange={(e) => set({ borderColor: e.target.value })} aria-label="Line colour" />}
      </div>
    </div>
  );
}

/** Edit a split screen that has been added (on air too: boxes glide to the new layout). */
export function SplitEditor({
  source,
  sources,
  act,
  client,
  onClose,
}: {
  source: Source;
  sources: Source[];
  act: Act;
  client: EngineClient;
  onClose: () => void;
}) {
  const [split, setSplit] = useState<Split | null>(() => (source.kind.type === 'split' ? structuredClone(source.kind) : null));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!split) return null;
  const preview: Source = { ...source, kind: { type: 'split', ...split } };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Split screen" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box spled">
        <header className="modal__head">
          <h2>Split screen · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="spled__body">
          <div className="spled__preview">
            <SourceView source={preview} client={client} report={false} />
          </div>
          <SplitPicker split={split} sources={sources.filter((s) => s.id !== source.id)} onChange={setSplit} />
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              act({ type: 'updateSplit', id: source.id, split });
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
