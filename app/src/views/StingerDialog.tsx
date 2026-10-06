import { Film, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { Stinger } from '../engine/types/Stinger';
import type { Act } from './act';
import './StingerDialog.css';

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const empty: Stinger = { path: '', durationMs: 0, cutMs: 0 };

/**
 * Set up the two stinger transitions: pick a short video (see-through .mov
 * or .webm works best) and the moment it covers the screen — the pictures
 * change underneath there.
 */
export function StingerDialog({ show, act, client, onClose }: { show: Show; act: Act; client: EngineClient; onClose: () => void }) {
  const [slot, setSlot] = useState(0);
  const saved = show.settings.stingers?.[slot] ?? empty;
  const [draft, setDraft] = useState<Stinger>(saved);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => setDraft(show.settings.stingers?.[slot] ?? empty), [slot]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const pick = async () => {
    const f = await client.pickFile('video').catch(() => null);
    if (f) setDraft({ path: f.path, durationMs: 0, cutMs: 0 });
  };
  // The video tells its length; the cut starts in the middle.
  const loaded = () => {
    const v = video.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const durationMs = Math.round(v.duration * 1000);
    setDraft((d) =>
      d.durationMs === durationMs ? d : { ...d, durationMs, cutMs: d.cutMs > 0 && d.cutMs <= durationMs ? d.cutMs : Math.round(durationMs / 2) },
    );
  };
  const seek = (ms: number) => {
    setDraft((d) => ({ ...d, cutMs: ms }));
    if (video.current) {
      video.current.pause();
      video.current.currentTime = ms / 1000;
    }
  };
  const play = () => {
    const v = video.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  };
  const save = () => {
    act({ type: 'setStinger', index: slot, stinger: draft });
    if (draft.path) act({ type: 'setTransition', kind: slot === 0 ? 'stinger1' : 'stinger2' });
    onClose();
  };
  const name = draft.path.split(/[\\/]/).pop() ?? '';

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Stingers" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box stg">
        <header className="modal__head">
          <h2>
            <Film className="modal__icon" aria-hidden="true" />
            Stinger transitions
          </h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="stg__body">
          <div className="stg__slots" role="radiogroup" aria-label="Stinger">
            {[0, 1].map((i) => (
              <button key={i} type="button" role="radio" aria-checked={slot === i} className="seg" onClick={() => setSlot(i)}>
                Stinger {i + 1}
                {show.settings.stingers?.[i]?.path ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <div className="stg__stage">
            {draft.path ? (
              <video
                ref={video}
                key={draft.path}
                src={client.mediaUrl(draft.path)}
                muted
                playsInline
                preload="auto"
                onLoadedMetadata={loaded}
                onLoadedData={() => video.current && (video.current.currentTime = draft.cutMs / 1000)}
              />
            ) : (
              <p className="stg__empty">
                A stinger is a short video that sweeps over the screen — a logo wipe, a splash of color. The switch happens hidden behind it.
              </p>
            )}
          </div>
          <div className="stg__row">
            <button type="button" className="btn" onClick={() => void pick()}>
              {draft.path ? 'Change video…' : 'Choose a video…'}
            </button>
            {draft.path && (
              <>
                <span className="stg__name" title={draft.path}>
                  {name} · {secs(draft.durationMs)}
                </span>
                <button type="button" className="btn" onClick={play}>
                  ▶ Play
                </button>
                <button type="button" className="btn" onClick={() => setDraft(empty)}>
                  Remove
                </button>
              </>
            )}
          </div>
          {draft.path && draft.durationMs > 0 && (
            <label className="field">
              <span className="field__label">Cut point — {secs(draft.cutMs)} (move it to the moment the video covers the whole screen)</span>
              <input
                type="range"
                min={0}
                max={draft.durationMs}
                step={10}
                value={draft.cutMs}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Cut point"
              />
            </label>
          )}
          <p className="field__note">
            See-through videos (.mov ProRes 4444 or .webm with alpha) show the pictures around the sweep. Choose Stinger 1 or 2 under “More…” next to the
            transitions.
          </p>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <span className="remote__spacer" />
          <button type="button" className="btn btn--primary" onClick={save} disabled={!!draft.path && draft.durationMs === 0}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
