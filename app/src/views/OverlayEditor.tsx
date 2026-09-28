import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Frame } from '../engine/types/Frame';
import type { Overlay } from '../engine/types/Overlay';
import type { OverlayAnim } from '../engine/types/OverlayAnim';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { ANIMS, PLACES, clampFrame } from '../engine/overlays';
import { SourceView } from '../components/SourceView';
import type { Act } from './act';
import './OverlayBar.css';

type Drag = { mode: 'move' | 'size'; x: number; y: number; start: Frame };

/**
 * Set up an overlay channel: what it shows, where (drag the box, or pick a
 * ready-made place), how it comes in and goes out, and on which screens.
 * Nothing changes on air until Save; "Show in Next" lets you check it on
 * the Next monitor first.
 */
export function OverlayEditor({ show, channel, act, client, onClose }: { show: Show; channel: number; act: Act; client: EngineClient; onClose: () => void }) {
  const [ch, setCh] = useState(channel);
  const [draft, setDraft] = useState<Overlay>(() => structuredClone(show.overlays[channel]!));
  const [drag, setDrag] = useState<Drag | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const set = (patch: Partial<Overlay>) => setDraft((d) => ({ ...d, ...patch }));
  const setFrame = (f: Frame) => set({ frame: clampFrame(f) });
  const pictures = show.sources.filter((s) => s.kind.type !== 'microphone');
  const src = show.sources.find((s) => s.id === draft.sourceId);
  const behind = show.sources.find((s) => s.id === show.screens.live.program);
  const current = show.overlays[ch]!;

  const pick = (n: number) => {
    setCh(n);
    setDraft(structuredClone(show.overlays[n]!));
  };
  const save = () => {
    if (draft.sourceId !== current.sourceId) act({ type: 'setOverlaySource', channel: ch, sourceId: draft.sourceId });
    const { frame, opacity, animIn, animOut, animMs, autoHideMs, screens } = draft;
    act({ type: 'updateOverlay', channel: ch, patch: { frame, opacity, animIn, animOut, animMs, autoHideMs: autoHideMs ?? 0, screens } });
  };

  // Drag the box to move it; drag its corner to resize.
  const start = (mode: Drag['mode']) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ mode, x: e.clientX, y: e.clientY, start: draft.frame });
  };
  const move = (e: React.PointerEvent) => {
    const r = stage.current?.getBoundingClientRect();
    if (!drag || !r) return;
    const dx = ((e.clientX - drag.x) / r.width) * 100;
    const dy = ((e.clientY - drag.y) / r.height) * 100;
    const f = drag.start;
    setFrame(drag.mode === 'move' ? { ...f, x: f.x + dx, y: f.y + dy } : { ...f, w: f.w + dx, h: f.h + dy });
  };
  const num = (k: keyof Frame) => (
    <label className="oved__num">
      {k.toUpperCase()}
      <input
        type="number"
        className="text"
        step={0.5}
        value={Math.round(draft.frame[k] * 10) / 10}
        onChange={(e) => setFrame({ ...draft.frame, [k]: Number(e.target.value) })}
        aria-label={{ x: 'Left', y: 'Top', w: 'Width', h: 'Height' }[k]}
      />
    </label>
  );
  const screenBox = (id: ScreenId, name: string) => (
    <label className="check">
      <input
        type="checkbox"
        checked={draft.screens.includes(id)}
        onChange={(e) => set({ screens: e.target.checked ? [...draft.screens, id] : draft.screens.filter((s) => s !== id) })}
      />
      {name}
    </label>
  );
  const animSelect = (value: OverlayAnim, onChange: (a: OverlayAnim) => void, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value as OverlayAnim)} aria-label={label}>
      {ANIMS.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Overlays" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box oved">
        <header className="modal__head">
          <h2>Overlays</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="oved__body">
          <nav className="oved__chs" aria-label="Overlay channel">
            {show.overlays.map((o, n) => (
              <button key={n} type="button" className={`oved__chbtn${n === ch ? ' is-on' : ''}`} aria-pressed={n === ch} onClick={() => pick(n)}>
                <b>{n + 1}</b>
                <span>{show.sources.find((s) => s.id === o.sourceId)?.name ?? 'empty'}</span>
                {o.on && <i className="oved__air">ON AIR</i>}
              </button>
            ))}
            <p className="field__note">Buttons 1 – 4 under the On air picture put these on and off air (Shift + 1 – 4).</p>
          </nav>

          <section className="oved__stagewrap">
            <div ref={stage} className="oved__stage" onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
              {behind && <SourceView source={behind} client={client} report={false} />}
              <div className="oved__safe" aria-hidden />
              {src && (
                <div
                  className="oved__box"
                  style={{
                    left: `${draft.frame.x}%`,
                    top: `${draft.frame.y}%`,
                    width: `${draft.frame.w}%`,
                    height: `${draft.frame.h}%`,
                    opacity: draft.opacity,
                  }}
                  onPointerDown={start('move')}
                  data-testid="overlay-box"
                >
                  <SourceView source={src} client={client} report={false} />
                  <span className="oved__handle" onPointerDown={start('size')} aria-label="Drag to resize" />
                </div>
              )}
              {!src && <span className="mon__empty">Choose what this overlay shows (on the right)</span>}
            </div>
            <p className="field__note">
              Drag the box to move it, its corner to resize. Behind it: what is on the Live Screen now. Dashed line: the safe area (90%).
            </p>
            <div className="oved__places">
              {PLACES.map((p) => (
                <button key={p.name} type="button" className="btn" onClick={() => setFrame(p.frame)}>
                  {p.name}
                </button>
              ))}
            </div>
          </section>

          <section className="oved__props" aria-label="Overlay settings">
            <label className="field">
              <span className="field__label">Shows</span>
              <select value={draft.sourceId ?? ''} onChange={(e) => set({ sourceId: e.target.value || null })} aria-label="Overlay input">
                <option value="">Nothing (empty)</option>
                {pictures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="field__label">Position and size (% of the screen)</span>
            <div className="oved__nums">
              {num('x')}
              {num('y')}
              {num('w')}
              {num('h')}
            </div>
            <label className="field">
              <span className="field__label">Opacity · {Math.round(draft.opacity * 100)}%</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(draft.opacity * 100)}
                onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
                aria-label="Opacity"
              />
            </label>
            <span className="field__label">Animation</span>
            <div className="oved__anim">
              In {animSelect(draft.animIn, (a) => set({ animIn: a }), 'Comes in')}
              Out {animSelect(draft.animOut, (a) => set({ animOut: a }), 'Goes out')}
              <select value={draft.animMs} onChange={(e) => set({ animMs: Number(e.target.value) })} aria-label="Animation length">
                {[0, 250, 500, 800, 1200, 2000].map((ms) => (
                  <option key={ms} value={ms}>
                    {ms / 1000} s
                  </option>
                ))}
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={draft.autoHideMs !== null} onChange={(e) => set({ autoHideMs: e.target.checked ? 8000 : null })} />
              Take off by itself after
              <input
                type="number"
                className="text oved__secs"
                min={1}
                max={600}
                disabled={draft.autoHideMs === null}
                value={(draft.autoHideMs ?? 8000) / 1000}
                onChange={(e) => set({ autoHideMs: Math.round(Math.min(600, Math.max(1, Number(e.target.value) || 8)) * 1000) })}
                aria-label="Seconds before it goes off"
              />
              s
            </label>
            <p className="field__note">A video overlay goes off when it ends, unless the video is set to loop.</p>
            <span className="field__label">Goes on</span>
            <div className="oved__row">
              {screenBox('live', 'Live Screen')}
              {screenBox('back', 'Back Screen')}
            </div>
            <p className="field__note">The Monitor shows text only, so overlays never go there.</p>
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
            disabled={!draft.sourceId}
            onClick={() => {
              save();
              act({ type: 'setOverlayInNext', channel: ch, value: !current.inNext });
            }}
          >
            {current.inNext ? 'Stop showing in Next' : 'Save and show in Next'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              save();
              onClose();
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!draft.sourceId}
            onClick={() => {
              save();
              act({ type: 'setOverlayOn', channel: ch, value: !current.on });
              onClose();
            }}
          >
            {current.on ? 'Save and take off air' : 'Save and put on air'}
          </button>
        </footer>
      </div>
    </div>
  );
}
