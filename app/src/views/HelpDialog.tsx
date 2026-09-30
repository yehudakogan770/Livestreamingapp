import { useEffect, useMemo, useState } from 'react';
import { MANUAL, searchManual } from '../help/manual';
import './HelpDialog.css';

/** How to use Lumora: every topic in plain words, with a search. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [id, setId] = useState(MANUAL[0]!.id);
  const found = useMemo(() => searchManual(q), [q]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const topic = found.find((t) => t.id === id) ?? found[0];
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="How to use Lumora" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box hlp">
        <header className="modal__head">
          <h2>How to use Lumora</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="hlp__body">
          <nav className="hlp__nav" aria-label="Topics">
            <input
              className="text"
              autoFocus
              value={q}
              placeholder="Search (e.g. camera, pesukim, stream)"
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search the manual"
            />
            {found.length === 0 && <p className="field__note">Nothing found. Try another word.</p>}
            {found.map((t) => (
              <button key={t.id} type="button" className={`hlp__topic${topic?.id === t.id ? ' is-on' : ''}`} onClick={() => setId(t.id)}>
                {t.title}
              </button>
            ))}
          </nav>
          <article className="hlp__page">
            {topic && (
              <>
                <h3>{topic.title}</h3>
                {topic.body.map((p, i) =>
                  /^\d+\. /.test(p) ? (
                    <p key={i} className="hlp__step">
                      <b>{p.match(/^\d+/)![0]}</b>
                      {p.replace(/^\d+\. /, '')}
                    </p>
                  ) : p.startsWith('• ') ? (
                    <p key={i} className="hlp__point">
                      {p.slice(2)}
                    </p>
                  ) : p.startsWith('Tip: ') ? (
                    <p key={i} className="hlp__tip">
                      💡 {p.slice(5)}
                    </p>
                  ) : (
                    <p key={i}>{p}</p>
                  ),
                )}
              </>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
