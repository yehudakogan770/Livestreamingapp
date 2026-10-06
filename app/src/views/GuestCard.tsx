import { UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import { inviteUrl } from '../engine/guest';
import { SourceView } from '../components/SourceView';
import type { Act } from './act';
import './StingerDialog.css';

/** A guest's link to send, and their picture. */
export function GuestCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const g = source.kind.type === 'guest' ? source.kind : null;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!g) return null;
  const link = inviteUrl(g, source.name);
  const copy = () =>
    void navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Guest" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box stg">
        <header className="modal__head">
          <h2>
            <UserRound className="modal__icon" aria-hidden="true" />
            Guest · {source.name}
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="stg__body">
          <div className="stg__stage" style={{ background: '#000' }}>
            <SourceView source={source} client={client} report={false} />
          </div>
          <label className="field">
            <span className="field__label">Send this link to the guest (WhatsApp, email…)</span>
            <div className="stg__row">
              <input
                className="text"
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
                aria-label="Guest link"
                style={{ flex: '1 1 auto', minWidth: 0 }}
              />
              <button type="button" className="btn btn--primary" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          </label>
          <p className="field__note">
            The guest opens it, allows the camera and microphone, and presses Start. Their picture shows here within a few seconds, and their voice comes into
            the mixer. They should use headphones so they don't hear themselves back. Anyone with the link can join as this guest — send it only to them.
          </p>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={() => act({ type: 'reloadGuest', id: source.id })} title="If the picture froze or the guest rejoined">
            ↻ Reconnect
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
