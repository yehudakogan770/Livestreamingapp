import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { ChromaKey } from '../engine/types/ChromaKey';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { SourceView } from '../components/SourceView';
import { defaultSplit } from '../engine/split';
import type { Act } from './act';
import './GreenScreenDialog.css';

const COLOURS = [
  { name: 'Green screen', color: '#00b140' },
  { name: 'Blue screen', color: '#0047bb' },
];
const BEHIND = ['camera', 'video', 'image', 'color', 'pattern', 'slideshow', 'visuals'];

/**
 * Green screen for a camera, video or picture: turn it on, pick the color
 * (or click it in the picture), tune the edge, and see it over a
 * background. "Make a scene" puts it in front of a background as a new
 * input, ready for Next and TAKE.
 */
export function GreenScreenDialog({ show, source, act, client, onClose }: { show: Show; source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const [key, setKey] = useState<ChromaKey>(() => ({ ...source.key, enabled: true }));
  const backgrounds = show.sources.filter((s) => s.id !== source.id && BEHIND.includes(s.kind.type));
  const [behindId, setBehindId] = useState<string>(backgrounds[0]?.id ?? '');
  const [picking, setPicking] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const set = (p: Partial<ChromaKey>) => setKey((k) => ({ ...k, ...p }));
  const behind = show.sources.find((s) => s.id === behindId);
  const preview: Source = { ...source, key };
  const save = () => act({ type: 'updateSource', id: source.id, patch: { key } });

  // Click the green in the picture to take exactly that color.
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!picking) return;
    setPicking(false);
    const el = stage.current?.querySelector('.gs__subject video, .gs__subject img');
    const r = stage.current?.getBoundingClientRect();
    if (!(el instanceof HTMLVideoElement || el instanceof HTMLImageElement) || !r) return;
    const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!iw || !ih) return;
    // Where the click is on the picture (it is fitted into the box).
    const scale = source.fit === 'cover' ? Math.max(r.width / iw, r.height / ih) : Math.min(r.width / iw, r.height / ih);
    const x = (e.clientX - r.left - (r.width - iw * scale) / 2) / scale;
    const y = (e.clientY - r.top - (r.height - ih * scale) / 2) / scale;
    if (x < 0 || y < 0 || x >= iw || y >= ih) return;
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const g = c.getContext('2d');
    if (!g) return;
    try {
      g.drawImage(el, x, y, 1, 1, 0, 0, 1, 1);
      const [rr, gg, bb] = g.getImageData(0, 0, 1, 1).data;
      set({ color: `#${[rr, gg, bb].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}` });
    } catch {
      /* the picture can't be read here */
    }
  };

  const slider = (label: string, k: 'similarity' | 'smoothness' | 'spill', hint: string) => (
    <label className="field">
      <span className="field__label">
        {label} · {Math.round(key[k] * 100)}
      </span>
      <input type="range" min={0} max={100} value={Math.round(key[k] * 100)} onChange={(e) => set({ [k]: Number(e.target.value) / 100 })} aria-label={label} />
      <span className="field__note">{hint}</span>
    </label>
  );

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Green screen" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box gs">
        <header className="modal__head">
          <h2>Green screen · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="gs__body">
          <section className="gs__main">
            <div ref={stage} className={`gs__stage${picking ? ' is-picking' : ''}${behind ? '' : ' gs__stage--checker'}`} onPointerDown={pick}>
              {behind && <SourceView source={behind} client={client} report={false} />}
              <div className="gs__subject">
                <SourceView source={preview} client={client} report={false} />
              </div>
              {picking && <span className="gs__hint">Click the green (or blue) in the picture</span>}
            </div>
            <label className="field">
              <span className="field__label">Preview it over</span>
              <select value={behindId} onChange={(e) => setBehindId(e.target.value)} aria-label="Preview over">
                <option value="">A checkerboard (see-through)</option>
                {backgrounds.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="gs__props">
            <label className="check">
              <input type="checkbox" checked={key.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Take out the color (green screen on)
            </label>
            <span className="field__label">Color</span>
            <div className="gs__colours">
              {COLOURS.map((c) => (
                <button key={c.color} type="button" className="seg" aria-pressed={key.color === c.color} onClick={() => set({ color: c.color })}>
                  <i style={{ background: c.color }} /> {c.name}
                </button>
              ))}
              <input type="color" value={key.color} onChange={(e) => set({ color: e.target.value })} aria-label="Key color" />
            </div>
            <button type="button" className={`btn${picking ? ' is-on' : ''}`} onClick={() => setPicking(!picking)}>
              {picking ? 'Click in the picture…' : '⌖ Pick the color from the picture'}
            </button>
            {slider('How much is taken out', 'similarity', 'Raise it until all the green is gone; lower it if people start to disappear.')}
            {slider('Soft edge', 'smoothness', 'Softens the edge around people and hair.')}
            {slider('Remove green glow', 'spill', 'Takes away green light reflected on people.')}
            <p className="field__note">
              What shows through: whatever is behind this input — put it in a split screen or on an overlay, or behind slides. Or make a scene here:
            </p>
          </section>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <span className="remote__spacer" />
          <button
            type="button"
            className="btn"
            disabled={!behind}
            title={behind ? `A new input: ${source.name} in front of ${behind.name}` : 'Choose a background under the preview first'}
            onClick={() => {
              save();
              if (behind) {
                const full = { x: 0, y: 0, w: 100, h: 100 };
                act({
                  type: 'addSource',
                  source: {
                    name: `${source.name} on ${behind.name}`,
                    kind: {
                      type: 'split',
                      ...defaultSplit(),
                      layout: 'custom',
                      gap: 0,
                      boxes: [
                        { sourceId: behind.id, frame: full },
                        { sourceId: source.id, frame: full },
                      ],
                    },
                  },
                });
              }
              onClose();
            }}
          >
            Make a scene with this background
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              save();
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
