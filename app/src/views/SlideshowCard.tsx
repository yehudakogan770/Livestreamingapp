import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { slideshowTarget } from '../engine/slideshow';
import { SlideshowEditor } from './SlideshowEditor';
import type { Act } from './act';
import './PesukimCard.css';
import './SlideshowEditor.css';

/** Typing in a field, or a dialog open: keys belong there. */
function keysElsewhere(e: KeyboardEvent): boolean {
  const t = e.target;
  return (t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]')) || !!document.querySelector('.modal');
}

/**
 * A slideshow, run live: back, next, and every slide to jump to. Keys (and
 * presenter clickers): Space, → or Page Down next · ← or Page Up back.
 */
export function SlideshowCard({ show, act, screen, client }: { show: Show; act: Act; screen: ScreenId; client: EngineClient }) {
  const target = slideshowTarget(show, screen);
  const [editing, setEditing] = useState(false);
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = latest.current;
      if (!t || e.ctrlKey || e.metaKey || e.altKey || keysElsewhere(e)) return;
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'PageDown') act({ type: 'slideNext', id: t.id });
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') act({ type: 'slidePrevious', id: t.id });
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ' && latest.current && !keysElsewhere(e)) e.preventDefault();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [act]);
  if (!target) return null;
  const { id, sh, where } = target;
  const source = show.sources.find((s) => s.id === id)!;
  const nameOf = (sid: string) => show.sources.find((s) => s.id === sid)?.name ?? '';
  return (
    <div className="pk" aria-label="Slideshow">
      <div className="pk__head">
        <b className={`cd__tag cd__tag--${where}`}>{where === 'next' ? 'NEXT' : 'ON AIR'}</b>
        <span className="pk__where">
          Slide {Math.min(sh.current + 1, sh.slides.length)} of {sh.slides.length}
          {sh.autoMs !== null && <em> · every {sh.autoMs / 1000} s</em>}
        </span>
        <button type="button" className="btn pk__edit" onClick={() => setEditing(true)}>
          Edit…
        </button>
      </div>
      <div className="pk__row pk__row--main">
        <button type="button" className="btn" onClick={() => act({ type: 'slidePrevious', id })} title="Back (←)">
          ‹ Back
        </button>
        <button type="button" className="btn btn--primary pk__go" onClick={() => act({ type: 'slideNext', id })} title="Space, → or the clicker">
          Next slide › <kbd>Space</kbd>
        </button>
      </div>
      <div className="slc__strip" aria-label="Slides: click to jump">
        {sh.slides.map((sl, i) => (
          <button
            key={i}
            type="button"
            className={`slc__thumb${i === sh.current ? ' is-now' : ''}`}
            onClick={() => act({ type: 'slideGo', id, index: i })}
            aria-label={`Slide ${i + 1}`}
            ref={i === sh.current ? (el) => el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) : undefined}
          >
            {sl.type === 'image' ? <img src={client.mediaUrl(sl.path)} alt="" draggable={false} /> : <span>{nameOf(sl.sourceId)}</span>}
            <i>{i + 1}</i>
          </button>
        ))}
      </div>
      {editing && <SlideshowEditor source={source} sources={show.sources} act={act} client={client} onClose={() => setEditing(false)} />}
    </div>
  );
}
