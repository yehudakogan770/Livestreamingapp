import { useEffect, useRef, useState } from 'react';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { EngineClient } from '../engine/client';
import { barActions, PESUKIM, pesukimOf, pesukimTarget, soundAndMeaning, standardPesukim, wordsOf } from '../engine/pesukim';
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
  const { sound, meaning } = soundAndMeaning(data, whole);
  const child = data.pesukim[pasuk]?.child;
  const filled = data.pesukim.filter((p) => p.text.trim()).length;
  const font = `"${data.look.font}", "Frank Ruhl Libre", serif`;

  return (
    <div className="pk" aria-label="12 Pesukim">
      <div className="pk__head">
        <b className={`cd__tag cd__tag--${target.where}`}>{target.where === 'next' ? 'NEXT' : 'ON AIR'}</b>
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
          <div className="pk__now" dir="auto">
            <span className="pk__word" style={{ fontFamily: font }} data-testid="pesukim-now">
              {blank ? (
                <span className="pk__off">words hidden</span>
              ) : intro ? (
                <span className="pk__intro">Showing {child ? `${child}’s name` : 'the name'}</span>
              ) : whole ? (
                <span className="pk__intro">Whole pasuk on the screen</span>
              ) : (
                (words[word] ?? '—')
              )}
            </span>
            {!intro && !blank && !whole && (sound || meaning) && (
              <span className="pk__sound" dir="ltr">
                {sound && <i>{sound}</i>}
                {sound && meaning && ' · '}
                {meaning}
              </span>
            )}
          </div>
          <div className="pk__row pk__row--main">
            <button type="button" className="btn" onClick={() => act({ type: 'pesukimBack', id })} title="Back a word (←)">
              ‹ Back
            </button>
            <button type="button" className="btn btn--primary pk__go" onClick={() => act({ type: 'pesukimNext', id })} title="Space, → or the clicker">
              <span className="pk__go-what">{intro ? 'First word ›' : atEnd && pasuk + 1 < PESUKIM ? 'Next pasuk ›' : 'Next word ›'}</span>
              <span className="pk__go-next" dir="auto" style={{ fontFamily: font }}>
                {nextWord}
              </span>
            </button>
          </div>
          <div className="pk__row pk__row--small">
            {target.channel !== undefined ? (
              <button
                type="button"
                className={`btn${target.where === 'onAir' ? ' pk__bar--on' : ' btn--primary'}`}
                onClick={() => act({ type: 'setOverlayOn', channel: target.channel!, value: target.where !== 'onAir' })}
                title={target.where === 'onAir' ? 'Take the bar off the screen' : 'Show the bar on the screen'}
              >
                {target.where === 'onAir' ? 'Bar off' : 'Bar on'}
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => barActions(show, id, screen, false).forEach((a) => act(a))}
                title="Make it a bar over the camera (the camera stays on)"
              >
                As a bar
              </button>
            )}
            <button
              type="button"
              className={`btn${data.look.plain ? ' is-on' : ''}`}
              aria-pressed={data.look.plain}
              onClick={() => act({ type: 'updatePesukim', id, look: { ...data.look, plain: !data.look.plain } })}
              title="Just the words where the bar is (in two colours, easy to read), or the bar"
            >
              Text only
            </button>
            <button
              type="button"
              className={`btn${whole ? ' is-on' : ''}`}
              aria-pressed={whole}
              onClick={() => act({ type: 'pesukimWhole', id, value: !whole })}
              title="Whole pasuk (P)"
            >
              Whole <kbd>P</kbd>
            </button>
            <button
              type="button"
              className={`btn${blank ? ' is-on' : ''}`}
              aria-pressed={blank}
              onClick={() => act({ type: 'pesukimBlank', id, value: !blank })}
              title="Hide the words (B)"
            >
              Hide <kbd>B</kbd>
            </button>
          </div>
          {words.length > 0 && (
            <div className="pk__strip" dir="rtl" aria-label="Words: click to jump">
              {words.map((w, i) => (
                <button
                  key={i}
                  type="button"
                  className={intro ? '' : i === word ? 'is-now' : i < word ? 'is-said' : ''}
                  style={{ fontFamily: font }}
                  onClick={() => act({ type: 'pesukimGo', id, pasuk, word: i })}
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
