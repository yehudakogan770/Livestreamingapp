import type { Scripture } from '../engine/types/Scripture';
import { gematria } from '../engine/hebcal';
import { bookNow, fitSize, indexNow, reference, shownVerses, useTanach } from '../engine/tanach';
import './ScriptureView.css';

/** Where each part goes (in % of the frame height; the frame is 16:9, 177.8 wide). Shared with the recorder. */
export function scriptureLayout(s: Scripture) {
  const lower = s.look === 'lower';
  const both = s.lang === 'both';
  const width = lower ? 150 : 160;
  if (lower) {
    const top = 69;
    return both
      ? { lower, width, he: { top, h: 12 }, en: { top: top + 12.5, h: 8.5 }, ref: 91.5 }
      : { lower, width, he: { top, h: 21 }, en: { top, h: 21 }, ref: 91.5 };
  }
  return both
    ? { lower, width, he: { top: 9, h: 44 }, en: { top: 55, h: 29 }, ref: 90 }
    : { lower, width, he: { top: 10, h: 74 }, en: { top: 10, h: 74 }, ref: 90 };
}

/** The words shown: Hebrew and English, with verse numbers when the whole passage shows. */
export function scriptureText(s: Scripture) {
  const verses = shownVerses(s, bookNow(s.book));
  const many = verses.length > 1;
  return {
    he: verses.map(([n, h]) => (many ? `(${gematria(n).replace(/[׳״]/g, '')}) ${h}` : h)).join(' '),
    en: verses.map(([n, , e]) => (many ? `${n} ${e}` : e)).join(' '),
    count: verses.length,
  };
}

/** Tanach on screen. Mirrored in compositor.ts scripture(). */
export function ScriptureView({ s }: { s: Scripture }) {
  useTanach();
  const books = indexNow();
  const t = scriptureText(s);
  const L = scriptureLayout(s);
  const ref = reference(s, books?.[s.book]?.he);
  const heSize = fitSize(t.he.length, L.width, L.he.h, L.lower ? 4.6 : 7.5);
  const enSize = fitSize(t.en.length, L.width, L.en.h, L.lower ? 3.6 : 5.2);
  const empty = !t.count;
  return (
    <div className={`scr scr--${s.look}`} data-kind="scripture">
      {L.lower && !empty && <div className="scr__bar" />}
      {!empty && s.lang !== 'en' && (
        <div className="scr__box" style={{ top: `${L.he.top}cqh`, height: `${L.he.h}cqh`, width: `${L.width}cqh` }}>
          <p className="scr__he" dir="rtl" style={{ fontSize: `${heSize}cqh` }}>
            {t.he}
          </p>
        </div>
      )}
      {!empty && s.lang !== 'he' && (
        <div className="scr__box" style={{ top: `${L.en.top}cqh`, height: `${L.en.h}cqh`, width: `${L.width}cqh` }}>
          <p className="scr__en" style={{ fontSize: `${enSize}cqh` }}>
            {t.en}
          </p>
        </div>
      )}
      {!empty && s.showRef && (
        <p className="scr__ref" style={{ top: `${L.ref}cqh` }}>
          <span dir="rtl">{ref.he}</span> · {ref.en}
        </p>
      )}
    </div>
  );
}
