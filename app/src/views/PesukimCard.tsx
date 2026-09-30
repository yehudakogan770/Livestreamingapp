import { useEffect, useRef, useState } from 'react';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { EngineClient } from '../engine/client';
import { glossesOf, PESUKIM, pesukimOf, pesukimTarget, standardPesukim, wordsOf } from '../engine/pesukim';
import { PesukimEditor } from './PesukimEditor';
import type { Act } from './act';
import './PesukimCard.css';

/** Typing in a field, or a dialog open: keys belong there. */
function keysElsewhere(e: KeyboardEvent): boolean {
  const t = e.target;
  return (t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]')) || !!document.querySelector('.modal');
}

/**
 * The 12 Pesukim, run live: the word being said, the next word, and one
 * press to move on. Shown in place of the countdown when a Pesukim input is
 * on air (or in Next) on this screen.
 *
 * Keys: Space, → or Page Down (clickers) next word · ← or Page Up back ·
 * P whole pasuk · B hide the words.
 */
export function PesukimCard({ show, act, screen, client }: { show: Show; act: Act; screen: ScreenId; client?: EngineClient }) {
  const target = pesukimTarget(show, screen);
  const data = target ? pesukimOf(show, target.id) : null;
  const [editing, setEditing] = useState(false);
  const latest = useRef({ target, data });
  latest.current = { target, data };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const { target: t, data: d } = latest.current;
      if (!t || !d || e.ctrlKey || e.metaKey || e.altKey || keysElsewhere(e)) return;
      const id = t.id;
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'PageDown') act({ type: 'pesukimNext', id });
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') act({ type: 'pesukimBack', id });
      else if (e.key === 'p' || e.key === 'P') act({ type: 'pesukimWhole', id, value: !d.place.whole });
      else if (e.key === 'b' || e.key === 'B') act({ type: 'pesukimBlank', id, value: !d.place.blank });
      else return;
      // These keys mean Pesukim while it is running (B would otherwise blank the screen).
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // Space must not also press whichever button was clicked last.
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ' && latest.current.target && !keysElsewhere(e)) e.preventDefault();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [act]);

  if (!target || !data) return null;
  const id = target.id;
  const { pasuk, word, whole, blank, intro } = data.place;
  const words = wordsOf(data.pesukim[pasuk]?.text ?? '');
  const atEnd = !intro && word >= words.length - 1;
  const nextChild = data.pesukim[pasuk + 1]?.child.trim();
  const nextWord = intro
    ? words[0]
    : atEnd
      ? pasuk + 1 < PESUKIM
        ? `(pasuk ${pasuk + 2}${data.look.showName && nextChild ? ` · ${nextChild}’s name` : ''})`
        : '(the end)'
      : words[word + 1];
  const sound = wordsOf(data.pesukim[pasuk]?.translit ?? '')[word];
  const meaning = glossesOf(data.pesukim[pasuk]?.english ?? '')[word];
  const child = data.pesukim[pasuk]?.child;
  const filled = data.pesukim.filter((p) => p.text.trim()).length;
  const font = `"${data.look.font}", "Frank Ruhl Libre", serif`;

  return (
    <div className="pk" aria-label="12 Pesukim">
      <div className="pk__head">
        <b className={`cd__tag cd__tag--${target.where}`}>{target.where === 'next' ? 'NEXT' : 'ON AIR'}</b>
        <span className="pk__where">
          Pasuk {pasuk + 1} of 12{child ? ` · ${child}` : ''}
          {words.length > 0 && (
            <em>
              {' '}
              · word {Math.min(word + 1, words.length)} of {words.length}
            </em>
          )}
        </span>
        <button type="button" className="btn pk__edit" onClick={() => setEditing(true)}>
          Edit…
        </button>
      </div>

      {filled === 0 ? (
        <div className="pk__row">
          <button
            type="button"
            className="btn btn--primary pk__empty"
            onClick={() => act({ type: 'updatePesukim', id, pesukim: standardPesukim(data.pesukim.map((p) => p.child)) })}
          >
            Fill in the 12 Pesukim
          </button>
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Type my own…
          </button>
        </div>
      ) : (
        <>
          <div className="pk__now" dir="auto" style={{ fontFamily: font }} data-testid="pesukim-now">
            {blank ? (
              <span className="pk__off">words hidden</span>
            ) : intro ? (
              <span className="pk__intro">Showing {child ? `${child}’s name` : 'the name'}</span>
            ) : whole ? (
              words.join(' ')
            ) : (
              (words[word] ?? '—')
            )}
          </div>
          {!intro && !whole && !blank && (sound || meaning) && (
            <div className="pk__sound">
              {sound && <i>{sound}</i>}
              {sound && meaning && ' · '}
              {meaning}
            </div>
          )}
          <div className="pk__next" dir="auto">
            Next: <span style={{ fontFamily: font }}>{nextWord}</span>
          </div>
          <div className="pk__row pk__row--main">
            <button type="button" className="btn" onClick={() => act({ type: 'pesukimBack', id })} title="Back a word (←)">
              ‹ Back
            </button>
            <button type="button" className="btn btn--primary pk__go" onClick={() => act({ type: 'pesukimNext', id })} title="Space, → or the clicker">
              {intro ? 'First word ›' : atEnd && pasuk + 1 < PESUKIM ? 'Next pasuk ›' : 'Next word ›'}
              <kbd>Space</kbd>
            </button>
          </div>
          <div className="pk__row">
            <button
              type="button"
              className={`btn${whole ? ' is-on' : ''}`}
              aria-pressed={whole}
              onClick={() => act({ type: 'pesukimWhole', id, value: !whole })}
            >
              Whole pasuk <kbd>P</kbd>
            </button>
            <button
              type="button"
              className={`btn${blank ? ' is-on' : ''}`}
              aria-pressed={blank}
              onClick={() => act({ type: 'pesukimBlank', id, value: !blank })}
            >
              Hide words <kbd>B</kbd>
            </button>
          </div>
          <select
            className="pk__goto"
            aria-label="Go to pasuk"
            value={pasuk}
            onChange={(e) => act({ type: 'pesukimGo', id, pasuk: Number(e.target.value), word: 0 })}
          >
            {data.pesukim.map((p, i) => (
              <option key={i} value={i}>
                Pasuk {i + 1}
                {p.child ? ` · ${p.child}` : ''}
                {p.text.trim() ? '' : ' (empty)'}
              </option>
            ))}
          </select>
          {words.length > 0 && (
            <div className="pk__strip" dir="rtl" aria-label="Words: click to jump">
              {words.map((w, i) => (
                <button
                  key={i}
                  type="button"
                  className={intro ? '' : i === word ? 'is-now' : i < word ? 'is-said' : ''}
                  style={{ fontFamily: font }}
                  onClick={() => act({ type: 'pesukimGo', id, pasuk, word: i })}
                  ref={i === word ? (el) => el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) : undefined}
                >
                  {w}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {editing && <PesukimEditor show={show} id={id} act={act} client={client} onClose={() => setEditing(false)} />}
    </div>
  );
}
