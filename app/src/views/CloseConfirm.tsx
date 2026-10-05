import { useEffect, useRef, useState } from 'react';
import { useBroadcast } from '../broadcast/BroadcastContext';
import { closeApp, watchCloseRequests } from '../engine/client';

/** "Close Lumora?" — every time the window's close button is pressed. */
export function CloseConfirm() {
  const [asking, setAsking] = useState(false);
  const bc = useBroadcast();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => watchCloseRequests(() => setAsking(true)), []);
  useEffect(() => {
    if (!asking) return;
    keep.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAsking(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [asking]);
  if (!asking) return null;
  const live = bc?.status.streaming != null;
  const recording = bc?.status.recording != null;
  const ends =
    live && recording
      ? 'The live stream and the recording will stop.'
      : live
        ? 'The live stream will stop.'
        : recording
          ? 'The recording will stop and be saved.'
          : null;
  return (
    <div
      className="modal"
      role="alertdialog"
      aria-modal="true"
      aria-label="Close Lumora?"
      onPointerDown={(e) => e.target === e.currentTarget && setAsking(false)}
    >
      <div className="modal__box">
        <header className="modal__head">
          <h2>Close Lumora?</h2>
        </header>
        <p style={{ padding: '0 20px' }}>
          {ends && <strong>{ends} </strong>}
          The output screens close too. Your event is saved.
        </p>
        <footer className="modal__foot">
          <span className="remote__spacer" />
          <button ref={keep} type="button" className="btn" onClick={() => setAsking(false)}>
            Keep open
          </button>
          <button type="button" className={`btn${ends ? ' btn--danger' : ' btn--primary'}`} onClick={closeApp}>
            Close Lumora
          </button>
        </footer>
      </div>
    </div>
  );
}
