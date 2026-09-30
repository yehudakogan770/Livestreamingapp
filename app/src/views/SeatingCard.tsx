import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import type { Seating } from '../engine/types/Seating';
import { SeatingView } from '../components/SeatingView';
import { parseGuests } from '../engine/seating';
import { JoinSetup, useAudienceLink } from './JoinSetup';
import type { Act } from './act';
import './LyricsCard.css';
import './AudienceCards.css';

/** The table finder: the guest list, and how it shows. */
export function SeatingCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const s = source.kind.type === 'seating' ? source.kind : null;
  const id = source.id;
  const [text, setText] = useState('');
  const [title, setTitle] = useState(s?.title ?? '');
  const [find, setFind] = useState('');
  const { remote } = useAudienceLink(client, s, (joinUrl, joinQr) => s && act({ type: 'updateSeating', id, seating: { ...s, joinUrl, joinQr } }));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!s) return null;
  const update = (p: Partial<Seating>) => act({ type: 'updateSeating', id, seating: { ...s, ...p } });
  const add = (replace: boolean) => {
    const guests = parseGuests(text);
    if (!guests.length) return;
    update({ guests: replace ? guests : [...s.guests, ...guests] });
    setText('');
  };
  const openFile = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt,text/csv,text/plain';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) setText(await f.text());
    };
    input.click();
  };
  const q = find.trim().toLowerCase();
  const shown = q ? s.guests.filter((g) => g.name.toLowerCase().includes(q)) : s.guests;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Table finder" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>Table finder · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run">
            <div className="lyc__stage">
              <SeatingView s={s} />
            </div>
            <div className="lyc__bar" role="group" aria-label="How it looks">
              <button type="button" className={`btn btn--small${s.look === 'scan' ? ' is-on' : ''}`} onClick={() => update({ look: 'scan' })}>
                Code to scan
              </button>
              <button type="button" className={`btn btn--small${s.look === 'list' ? ' is-on' : ''}`} onClick={() => update({ look: 'list' })}>
                The whole list, page by page
              </button>
              <button type="button" className={`btn btn--small${s.open ? ' is-on' : ''}`} onClick={() => update({ open: !s.open })}>
                {s.open ? '■ Stop phones looking up' : '▶ Let phones look up'}
              </button>
            </div>
            <JoinSetup remote={remote} what="find their table" client={client} act={act} />
            <label className="field">
              <span className="field__label">Title</span>
              <input className="text" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => update({ title })} />
            </label>
          </section>
          <section className="lyc__edit">
            <label className="field">
              <span className="field__label">Paste the guest list: one guest a line, “Name, Table” (a spreadsheet saved as CSV works too)</span>
              <textarea
                className="text"
                dir="auto"
                rows={5}
                value={text}
                placeholder={'Cohen, David, 12\nSarah Levi, 4\nThe Katz family, 7'}
                onChange={(e) => setText(e.target.value)}
                aria-label="Guest list"
              />
            </label>
            <div className="lyc__bar">
              <button type="button" className="btn btn--small" onClick={() => void openFile()}>
                Open a file…
              </button>
              <button type="button" className="btn btn--primary" disabled={!text.trim()} onClick={() => add(false)}>
                + Add these guests
              </button>
              {s.guests.length > 0 && (
                <button type="button" className="btn btn--small" disabled={!text.trim()} onClick={() => confirm('Replace the whole list?') && add(true)}>
                  Replace the list
                </button>
              )}
            </div>
            <div className="lyc__row">
              <span className="field__label">
                {s.guests.length} guests · {new Set(s.guests.map((g) => g.table)).size} tables
              </span>
              <input
                className="text"
                style={{ flex: 1 }}
                placeholder="Find a guest"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                aria-label="Find a guest"
              />
            </div>
            <ul className="aud-card__list">
              {shown.slice(0, 300).map((g, i) => (
                <li key={`${g.name}|${i}`}>
                  <span dir="auto">
                    {g.name} · <b>table {g.table}</b>
                  </span>
                  <button type="button" className="icon" aria-label={`Remove ${g.name}`} onClick={() => update({ guests: s.guests.filter((x) => x !== g) })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
