import { BookOpen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Source } from '../engine/types/Source';
import type { Scripture } from '../engine/types/Scripture';
import { ScriptureView } from '../components/ScriptureView';
import { fixedFromCivil, gematria, hebrewFromFixed } from '../engine/hebcal';
import { BOOK_NAMES, bookNow, indexNow, loadBook, loadIndex, plain, TEHILLIM, tehillimForDay, tehillimForWeekday, useTanach } from '../engine/tanach';
import type { Act } from './act';
import './LyricsCard.css';
import './AudienceCards.css';
import './ScriptureCard.css';

const PARTS = [
  ['Torah', 'Torah'],
  ['Neviim', "Nevi'im"],
  ['Ketuvim', 'Kesuvim'],
] as const;
const FAVOURITES = [20, 23, 91, 100, 121, 130, 142, 150];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];

interface Hit {
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

/** Choose a passage of Tanach and step through it on screen. */
export function ScriptureCard({ source, act, onClose }: { source: Source; act: Act; onClose: () => void }) {
  useTanach();
  const s = source.kind.type === 'scripture' ? source.kind : null;
  const id = source.id;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!s) return null;
  const books = indexNow();
  const text = bookNow(s.book);
  const verses = books?.[s.book]?.chapters[s.chapter - 1] ?? 0;
  const set = (p: Partial<Scripture>) => {
    const n = { ...s, ...p };
    act({ type: 'updateScripture', id, scripture: n });
  };
  const passage = (book: number, chapter: number, from = 1, to?: number) => {
    const count = books?.[book]?.chapters[chapter - 1] ?? 1;
    const end = Math.min(count, to ?? count);
    set({ book, chapter, from, to: end, current: from, blank: false });
  };
  const today = new Date();
  const hday = hebrewFromFixed(fixedFromCivil(today.getFullYear(), today.getMonth() + 1, today.getDate())).day;
  const search = async () => {
    const q = plain(query.trim()).toLowerCase();
    if (q.length < 2) return;
    setSearching(true);
    const list = await loadIndex();
    const out: Hit[] = [];
    for (let b = 0; b < list.length && out.length < 60; b++) {
      const t = await loadBook(b);
      t.he.forEach((ch, c) =>
        ch.forEach((v, i) => {
          if (out.length >= 60) return;
          const en = t.en[c]?.[i] ?? '';
          if (plain(v).includes(q) || en.toLowerCase().includes(q)) out.push({ book: b, chapter: c + 1, verse: i + 1, text: /[a-z]/i.test(q) ? en : v });
        }),
      );
    }
    setHits(out);
    setSearching(false);
  };
  const rows = Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Tanach" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>
            <BookOpen className="modal__icon" aria-hidden="true" />
            Tanach · {source.name}
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run">
            <div className="lyc__stage">
              <ScriptureView s={s} />
            </div>
            <div className="lyc__bar">
              <button type="button" className="btn" disabled={s.whole || s.current <= s.from} onClick={() => act({ type: 'scriptureStep', id, delta: -1 })}>
                ◀ Previous
              </button>
              <button
                type="button"
                className="btn btn--primary btn--big"
                disabled={s.whole || s.current >= s.to}
                onClick={() => act({ type: 'scriptureStep', id, delta: 1 })}
              >
                Next verse ▶
              </button>
              <button type="button" className={`btn${s.blank ? ' is-on' : ''}`} onClick={() => act({ type: 'scriptureBlank', id, value: !s.blank })}>
                {s.blank ? 'Show again' : 'Blank'}
              </button>
              <span className="scr-card__gap" />
              <button type="button" className={`btn btn--small${!s.whole ? ' is-on' : ''}`} onClick={() => set({ whole: false })}>
                One verse
              </button>
              <button type="button" className={`btn btn--small${s.whole ? ' is-on' : ''}`} onClick={() => set({ whole: true })}>
                Whole passage
              </button>
            </div>
            {s.whole && s.to - s.from > 7 && (
              <p className="field__note field__note--warn">
                {s.to - s.from + 1} verses at once will be small on screen: choose fewer verses, or show one verse at a time.
              </p>
            )}
            <ol className="scr-card__verses" aria-label="Verses">
              {rows.map((n) => (
                <li key={n}>
                  <button
                    type="button"
                    className={!s.whole && n === s.current ? 'is-on' : ''}
                    onClick={() => (s.whole ? set({ whole: false, current: n }) : act({ type: 'scriptureGo', id, verse: n }))}
                  >
                    <b>{n}</b>
                    <span dir="rtl">{text?.he[s.chapter - 1]?.[n - 1] ?? '…'}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <section className="lyc__edit">
            <div className="lyc__row">
              <select className="text" value={s.book} onChange={(e) => passage(Number(e.target.value), 1)} aria-label="Book" style={{ flex: 2 }}>
                {PARTS.map(([part, label]) => (
                  <optgroup key={part} label={label}>
                    {(books ?? [])
                      .map((b, i) => [b, i] as const)
                      .filter(([b]) => b.part === part)
                      .map(([b, i]) => (
                        <option key={i} value={i}>
                          {BOOK_NAMES[i]} · {b.he}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <select className="text" value={s.chapter} onChange={(e) => passage(s.book, Number(e.target.value))} aria-label="Chapter" style={{ flex: 1 }}>
                {(books?.[s.book]?.chapters ?? []).map((_, i) => (
                  <option key={i} value={i + 1}>
                    Chapter {i + 1} · {gematria(i + 1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="lyc__row">
              <span className="field__label">Verses</span>
              <select
                className="text"
                value={s.from}
                onChange={(e) => passage(s.book, s.chapter, Number(e.target.value), Math.max(Number(e.target.value), s.to))}
                aria-label="From verse"
              >
                {Array.from({ length: verses }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
              <span>to</span>
              <select className="text" value={s.to} onChange={(e) => passage(s.book, s.chapter, s.from, Number(e.target.value))} aria-label="To verse">
                {Array.from({ length: verses }, (_, i) => i + 1)
                  .filter((n) => n >= s.from)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
              <button type="button" className="btn btn--small" onClick={() => passage(s.book, s.chapter)}>
                Whole chapter
              </button>
            </div>
            <div className="lyc__bar" role="group" aria-label="Language">
              {(
                [
                  ['he', 'עברית'],
                  ['en', 'English'],
                  ['both', 'Both'],
                ] as const
              ).map(([lang, label]) => (
                <button key={lang} type="button" className={`btn btn--small${s.lang === lang ? ' is-on' : ''}`} onClick={() => set({ lang })}>
                  {label}
                </button>
              ))}
              <span className="scr-card__gap" />
              {(
                [
                  ['full', 'Full screen'],
                  ['lower', 'Along the bottom'],
                ] as const
              ).map(([look, label]) => (
                <button key={look} type="button" className={`btn btn--small${s.look === look ? ' is-on' : ''}`} onClick={() => set({ look })}>
                  {label}
                </button>
              ))}
              <label className="check">
                <input type="checkbox" checked={s.showRef} onChange={(e) => set({ showRef: e.target.checked })} /> Where it is from
              </label>
            </div>
            <div className="scr-card__tehillim">
              <span className="field__label">Tehillim</span>
              <div className="lyc__bar">
                <span className="scr-card__what">Today (day {hday} of the month):</span>
                {tehillimForDay(hday).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="btn btn--small"
                    onClick={() => (hday === 25 ? passage(TEHILLIM, 119, 1, 96) : hday === 26 ? passage(TEHILLIM, 119, 97, 176) : passage(TEHILLIM, c))}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="lyc__bar">
                <span className="scr-card__what">{WEEKDAYS[today.getDay()]}:</span>
                <span className="scr-card__range">
                  {tehillimForWeekday(today.getDay())[0]}–{tehillimForWeekday(today.getDay()).at(-1)}
                </span>
                <button type="button" className="btn btn--small" onClick={() => passage(TEHILLIM, tehillimForWeekday(today.getDay())[0]!)}>
                  Start
                </button>
                <span className="scr-card__what">Often said:</span>
                {FAVOURITES.map((c) => (
                  <button key={c} type="button" className="btn btn--small" onClick={() => passage(TEHILLIM, c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="lyc__row">
              <input
                className="text"
                style={{ flex: 1 }}
                dir="auto"
                placeholder="Find words (Hebrew or English)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void search()}
                aria-label="Find words"
              />
              <button type="button" className="btn" disabled={searching || query.trim().length < 2} onClick={() => void search()}>
                {searching ? 'Finding…' : 'Find'}
              </button>
            </div>
            {hits && (
              <ul className="aud-card__list scr-card__hits">
                {hits.length === 0 && <li className="aud-card__none">Not found.</li>}
                {hits.map((h) => (
                  <li key={`${h.book}:${h.chapter}:${h.verse}`}>
                    <button type="button" className="scr-card__hit" onClick={() => passage(h.book, h.chapter, h.verse, h.verse)}>
                      <b>
                        {BOOK_NAMES[h.book]} {h.chapter}:{h.verse}
                      </b>{' '}
                      <span dir="auto">{h.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
