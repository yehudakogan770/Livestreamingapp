import { Cpu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { refreshEngineInfo, setEngineMode, testEngineRecording, useEngineInfo, type EngineMode } from '../engine/unified';
import './EngineDialog.css';

const MODES: { mode: EngineMode; label: string; hint: string }[] = [
  {
    mode: 'standard',
    label: 'Standard',
    hint: 'Each screen window draws its own picture and opens its own cameras. Everything works; this is the default.',
  },
  {
    mode: 'unified',
    label: 'Unified (beta)',
    hint: 'One engine opens each camera once, draws every screen once on the graphics card and feeds the windows and the recorder from there.',
  },
];

/** What Unified (beta) does not do yet (docs/ENGINE.md, "Phase 2"). */
const NOT_YET = [
  'Green screen, color adjustments and the frame delay are not applied to cameras yet (crop, zoom, move and flip are).',
  'Stream, web page, screen capture and guest inputs are not in the engine yet.',
  'A camera or video behind slides or behind Pesukim words is not shown yet (the slides and words are).',
  'Captions written into the stream picture, and instant replay, are not in Unified (beta) yet.',
];

/** Settings → Engine: Standard or Unified (beta), and how the unified engine is doing. */
export function EngineDialog({ onClose }: { onClose: () => void }) {
  const info = useEngineInfo();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  // Its statistics change every second.
  useEffect(() => {
    const id = setInterval(() => void refreshEngineInfo().catch(() => {}), 1000);
    return () => clearInterval(id);
  }, []);
  const choose = (mode: EngineMode) => {
    setBusy(true);
    setMessage(null);
    setEngineMode(mode)
      .then((i) => i.mode === 'unified' && !i.running && setMessage(i.error ?? 'The unified engine could not start.'))
      .catch((e: unknown) => setMessage(String(e)))
      .finally(() => setBusy(false));
  };
  const record = () => {
    setBusy(true);
    setMessage('Recording 10 seconds of the Live Screen through the engine…');
    testEngineRecording()
      .then(setMessage, (e: unknown) => setMessage(String(e)))
      .finally(() => setBusy(false));
  };
  const s = info?.stats;
  const unified = info?.mode === 'unified';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Engine" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box eng">
        <header className="modal__head">
          <h2>
            <Cpu className="modal__icon" aria-hidden="true" />
            Engine
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="eng__body">
          {!info && <p className="field__note">The engine choice is made in the Lumora app (not the browser demo).</p>}
          <div className="eng__modes" role="radiogroup" aria-label="Engine">
            {MODES.map((m) => (
              <label key={m.mode} className="eng__mode">
                <input type="radio" name="eng-mode" checked={(info?.mode ?? 'standard') === m.mode} disabled={!info || busy} onChange={() => choose(m.mode)} />
                <span>
                  <strong>{m.label}</strong>
                  <span className="field__note">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {unified && (
            <>
              <h3 className="eng__title">How it is doing</h3>
              {info.running && s ? (
                <dl className="eng__stats">
                  <dt>Graphics card</dt>
                  <dd>{s.adapter ? `${s.adapter.name} (${s.adapter.backend}, ${s.adapter.kind})` : '—'}</dd>
                  <dt>Time per frame</dt>
                  <dd>
                    {s.msPerFrame.toFixed(2)} ms (sending pictures {s.uploadMs.toFixed(2)}, drawing {s.renderMs.toFixed(2)}, windows {s.presentMs.toFixed(2)},
                    previews {s.readbackMs.toFixed(2)})
                  </dd>
                  <dt>Late frames</dt>
                  <dd>
                    {s.lateFrames} of {s.frames}
                  </dd>
                  <dt>Graphics</dt>
                  <dd>
                    {s.overlay
                      ? `${s.overlay.framesPerS.toFixed(1)} updates a second (${s.overlay.mbPerS.toFixed(1)} MB/s), ${Math.round(s.overlay.latencyMs)} ms behind, ${s.overlay.planes} shown`
                      : '—'}
                  </dd>
                  <dt>Encoding</dt>
                  <dd>
                    {s.feeds?.length
                      ? s.feeds
                          .map(
                            (f) =>
                              `${f.kind === 'input' ? 'camera file' : f.kind === 'vertical' ? 'vertical' : 'picture'}: ${f.stats?.framesIn ?? 0} frames${f.stats?.framesDropped ? `, ${f.stats.framesDropped} late` : ''}${f.error ? ` (${f.error})` : ''}`,
                          )
                          .join('; ')
                      : 'nothing now'}
                  </dd>
                  <dt>Screens in the engine’s windows</dt>
                  <dd>{s.outputs.length ? s.outputs.join(', ') : info.nativeOutputs ? 'none open (Outputs opens them)' : 'none (Windows only)'}</dd>
                </dl>
              ) : (
                <p className="field__note field__note--warn">{info.error ?? 'Starting…'}</p>
              )}
              {s?.notes.map((n) => (
                <p key={n} className="field__note">
                  {n}
                </p>
              ))}
              <h3 className="eng__title">Not in Unified (beta) yet</h3>
              <ul className="eng__list">
                {NOT_YET.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
          {message && (
            <p className="field__note" role="status">
              {message}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          {unified && info.running && (
            <button type="button" className="btn" disabled={busy} onClick={record}>
              Test the engine’s recording
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
