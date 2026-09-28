import { useEffect, useRef, useState } from 'react';
import type { CaptureKind } from '../engine/client';
import { clock } from '../engine/timing';
import { useBroadcast } from './BroadcastContext';
import './broadcast.css';

/** How long something has been running, ticking every second. */
function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [since]);
  return since === null ? '' : clock((now - since) / 1000);
}

/** REC and LIVE on the bottom bar. Stopping always asks first. */
export function BroadcastButtons({ onSettings }: { onSettings: () => void }) {
  const b = useBroadcast();
  const [confirm, setConfirm] = useState<{
    kind: CaptureKind;
    stopping: boolean;
  } | null>(null);
  const rec = b?.status.recording ?? null;
  const live = b?.status.streaming ?? null;
  const recTime = useElapsed(rec?.startedAt ?? null);
  const liveTime = useElapsed(live?.startedAt ?? null);
  // Say where a finished recording went, for a while.
  const last = b?.status.lastRecording ?? null;
  const [saved, setSaved] = useState<string | null>(null);
  const seen = useRef(last);
  useEffect(() => {
    if (last === seen.current) return;
    seen.current = last;
    setSaved(last);
    if (!last) return;
    const id = setTimeout(() => setSaved(null), 12000);
    return () => clearTimeout(id);
  }, [last]);
  if (!b) return null;
  const reconnecting = !live && b.reconnecting;
  const destinations = b.settings.destinations.filter((d) => d.enabled && d.url.trim());

  const press = (kind: CaptureKind) => {
    const running = kind === 'record' ? !!rec : !!live || !!reconnecting;
    if (running) return setConfirm({ kind, stopping: true });
    if (kind === 'record') return void b.start('record').catch(() => {});
    // Going live: set up first if there is nowhere to go, otherwise confirm.
    if (destinations.length === 0) return onSettings();
    setConfirm({ kind, stopping: false });
  };

  const yes = () => {
    if (!confirm) return;
    setConfirm(null);
    void (confirm.stopping ? b.stop(confirm.kind) : b.start(confirm.kind)).catch(() => {});
  };

  return (
    <>
      <button
        type="button"
        className={`btn bc-btn${rec ? ' bc-btn--rec' : ''}`}
        aria-pressed={!!rec}
        disabled={b.busy.record}
        title={rec?.path ? `Recording to ${rec.path}` : 'Record the Live Screen to a file'}
        onClick={() => press('record')}
      >
        <i className="bc-dot" />
        {rec ? `REC ${recTime}` : b.status.finishing ? 'Saving…' : 'REC'}
      </button>
      <button
        type="button"
        className={`btn bc-btn${live ? ' bc-btn--live' : ''}${reconnecting ? ' bc-btn--warn' : ''}`}
        aria-pressed={!!live}
        disabled={b.busy.stream}
        title={live ? `Live on ${live.destinations.join(', ')}` : 'Stream the Live Screen'}
        onClick={() => press('stream')}
      >
        <i className="bc-dot" />
        {live ? `LIVE ${liveTime}` : reconnecting ? 'Reconnecting…' : 'GO LIVE'}
      </button>

      {saved && (
        <div className="bc-saved" role="status">
          Recording saved:{' '}
          {saved.startsWith('blob:') ? (
            <a href={saved} download="Lumora recording.webm">
              download it
            </a>
          ) : (
            <span className="bc-saved__path">{saved}</span>
          )}
          <button type="button" className="icon" aria-label="Close" onClick={() => setSaved(null)}>
            ✕
          </button>
        </div>
      )}
      {confirm && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm" onPointerDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal__box confirm">
            <header className="modal__head">
              <h2>{confirm.stopping ? (confirm.kind === 'record' ? 'Stop recording?' : 'End the stream?') : 'Go live?'}</h2>
            </header>
            <p className="confirm__text">
              {confirm.stopping
                ? confirm.kind === 'record'
                  ? 'The recording is saved and a new one can be started any time.'
                  : 'Viewers will see the stream end.'
                : `The Live Screen goes out to ${destinations.map((d) => d.name).join(', ')}.`}
            </p>
            {!confirm.stopping && destinations.some((d) => !d.key.trim()) && (
              <p className="confirm__text field__note--warn">
                No stream key for{' '}
                {destinations
                  .filter((d) => !d.key.trim())
                  .map((d) => d.name)
                  .join(', ')}
                . Most services need one (Settings → Recording and streaming).
              </p>
            )}
            <footer className="modal__foot">
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className={`btn ${confirm.stopping ? 'btn--danger' : 'btn--primary'}`} onClick={yes} autoFocus>
                {confirm.stopping ? (confirm.kind === 'record' ? 'Stop recording' : 'End stream') : 'Go live'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
