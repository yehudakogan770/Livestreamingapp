import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import type { ScreenCapture } from '../engine/types/ScreenCapture';
import { SourceView } from '../components/SourceView';
import { CapturePicker } from './CapturePicker';
import type { Act } from './act';
import './StingerDialog.css';

/** Change which display or window a screen capture input shows. */
export function ScreenCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const start = source.kind.type === 'screen' ? { target: source.kind.target, cursor: source.kind.cursor } : null;
  const [cap, setCap] = useState<ScreenCapture | null>(start);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!start) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Screen capture" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box stg">
        <header className="modal__head">
          <h2>Screen capture · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="stg__body">
          <div className="stg__stage" style={{ background: '#000' }}>
            <SourceView source={source} client={client} report={false} />
          </div>
          <CapturePicker client={client} value={cap} onChange={setCap} />
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <span className="remote__spacer" />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!cap}
            onClick={() => {
              if (cap) act({ type: 'updateScreenCapture', id: source.id, capture: cap });
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
