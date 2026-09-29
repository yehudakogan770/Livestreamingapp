import { useEffect, useState } from 'react';
import type { Source } from '../engine/types/Source';
import type { Lyrics } from '../engine/types/Lyrics';
import type { TextStyle } from '../engine/types/TextStyle';
import { sections } from '../engine/lyrics';
import { TEXT_FONTS } from '../engine/text';
import { LyricsView } from '../components/LyricsView';
import type { Act } from './act';
import './LyricsCard.css';

/**
 * Run a song: click a slide (or ← → / space) to show it, B to hide the
 * words. The words and look are edited on the right and saved with Save.
 */
export function LyricsCard({ source, act, onClose }: { source: Source; act: Act; onClose: () => void }) {
  const live = source.kind.type === 'lyrics' ? source.kind : null;
  const [draft, setDraft] = useState<Lyrics | null>(() => (live ? structuredClone(live) : null));
  const id = source.id;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        if (e.key === 'Escape') onClose();
        return;
      }
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        act({ type: 'lyricsNext', id });
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        act({ type: 'lyricsPrevious', id });
      } else if (e.key === 'b' || e.key === 'B') act({ type: 'lyricsBlank', id, value: !live?.blank });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [act, id, live?.blank, onClose]);
  if (!live || !draft) return null;

  const slides = sections(live.text);
  const style = (p: Partial<TextStyle>) => setDraft({ ...draft, style: { ...draft.style, ...p } });
  const dirty = JSON.stringify({ ...draft, current: 0, blank: false, changedAt: 0 }) !== JSON.stringify({ ...live, current: 0, blank: false, changedAt: 0 });
  const save = () => act({ type: 'updateLyrics', id, lyrics: draft });
  const preview: Lyrics = { ...draft, current: live.current, blank: live.blank, changedAt: 0 };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Song" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>Song · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run" aria-label="Slides">
            <div className="lyc__bar">
              <button type="button" className="btn" onClick={() => act({ type: 'lyricsPrevious', id })}>
                ← Back
              </button>
              <button type="button" className="btn btn--primary" onClick={() => act({ type: 'lyricsNext', id })}>
                Next →
              </button>
              <button type="button" className={`btn${live.blank ? ' is-on' : ''}`} onClick={() => act({ type: 'lyricsBlank', id, value: !live.blank })}>
                {live.blank ? 'Show the words (B)' : 'Hide the words (B)'}
              </button>
              <span className="lyc__hint">← → or space to move</span>
            </div>
            <ol className="lyc__slides">
              {slides.map((t, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={`lyc__slide${i === live.current ? (live.blank ? ' is-hidden' : ' is-on') : ''}`}
                    onClick={() => act({ type: 'lyricsGo', id, index: i })}
                    dir="auto"
                  >
                    <b>{i + 1}</b>
                    {t}
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <section className="lyc__edit" aria-label="Words and look">
            <div className="lyc__stage">
              <LyricsView l={preview} />
            </div>
            <label className="field">
              <span className="field__label">Title</span>
              <input className="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Song title" />
            </label>
            <label className="field">
              <span className="field__label">Words — a blank line starts a new slide</span>
              <textarea
                className="text lyc__text"
                dir="auto"
                rows={8}
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                aria-label="Song words"
              />
            </label>
            <div className="lyc__row">
              <select value={draft.style.font} onChange={(e) => style({ font: e.target.value })} aria-label="Font">
                {TEXT_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <input type="color" value={draft.style.color} onChange={(e) => style({ color: e.target.value })} aria-label="Words colour" />
              <label className="check">
                <input type="checkbox" checked={draft.style.boxOn} onChange={(e) => style({ boxOn: e.target.checked })} /> Box behind
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.style.outline > 0} onChange={(e) => style({ outline: e.target.checked ? 3 : 0 })} /> Outline
              </label>
            </div>
            <label className="field">
              <span className="field__label">Size · {draft.style.size}</span>
              <input type="range" min={24} max={160} value={draft.style.size} onChange={(e) => style({ size: Number(e.target.value) })} aria-label="Size" />
            </label>
            <div className="lyc__row">
              <span className="field__label">Where</span>
              {(
                [
                  ['middle', 'Middle'],
                  ['low', 'Low (over a camera)'],
                ] as const
              ).map(([p, name]) => (
                <button key={p} type="button" className="seg" aria-pressed={draft.place === p} onClick={() => setDraft({ ...draft, place: p })}>
                  {name}
                </button>
              ))}
            </div>
          </section>
        </div>
        <footer className="modal__foot">
          <span className="lyc__hint">{slides.length} slides</span>
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn--primary" disabled={!dirty} onClick={save}>
            Save words and look
          </button>
        </footer>
      </div>
    </div>
  );
}
