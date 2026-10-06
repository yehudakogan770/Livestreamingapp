import { ListVideo, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Playlist } from '../engine/types/Playlist';
import type { Source } from '../engine/types/Source';
import { clock } from '../engine/timing';
import { playlistLength } from '../engine/playlist';
import type { Act } from './act';
import './PlaylistEditor.css';

const nameOf = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, '');

/**
 * A video input's playlist: the videos in order, going on by themselves.
 * Changes apply on Done; clicking a video (▶) plays it now.
 */
export function PlaylistEditor({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const [draft, setDraft] = useState<Playlist>(() =>
    source.playlist
      ? structuredClone(source.playlist)
      : {
          items: source.kind.type === 'video' ? [{ path: source.kind.path, name: source.name, durationS: source.kind.durationS }] : [],
          current: 0,
          autoNext: true,
          loopAll: false,
        },
  );
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (source.kind.type !== 'video') return null;
  const playingPath = source.kind.path;

  const add = async () => {
    const files = await client.pickFiles('video').catch(() => []);
    if (files.length) setDraft((d) => ({ ...d, items: [...d.items, ...files.map((f) => ({ path: f.path, name: nameOf(f.name), durationS: 0 }))] }));
  };
  const move = (from: number, to: number) =>
    setDraft((d) => {
      if (to < 0 || to >= d.items.length || from === to) return d;
      const items = [...d.items];
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it!);
      return { ...d, items };
    });
  const remove = (i: number) => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
  const save = () => {
    act({ type: 'setPlaylist', id: source.id, ...(draft.items.length ? { playlist: draft } : {}) });
    onClose();
  };
  const playNow = (i: number) => {
    // Save first so the list the video is in is the one shown here.
    act({ type: 'setPlaylist', id: source.id, playlist: draft });
    act({ type: 'playlistGo', id: source.id, index: i });
    act({ type: 'play', id: source.id });
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Playlist" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box pl">
        <header className="modal__head">
          <h2>
            <ListVideo className="modal__icon" aria-hidden="true" />
            Playlist · {source.name}
          </h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="pl__body">
          <div className="pl__bar">
            <button type="button" className="btn btn--primary" onClick={() => void add()}>
              + Add videos…
            </button>
            <label className="check">
              <input type="checkbox" checked={draft.autoNext} onChange={(e) => setDraft({ ...draft, autoNext: e.target.checked })} /> Play the next one by
              itself
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.loopAll} onChange={(e) => setDraft({ ...draft, loopAll: e.target.checked })} /> Start again after the last
            </label>
            <span className="pl__total">
              {draft.items.length} videos · {clock(playlistLength(draft))}
            </span>
          </div>
          <ol className="pl__list">
            {draft.items.map((it, i) => {
              const current = it.path === playingPath;
              return (
                <li
                  key={`${it.path}:${i}`}
                  className={`pl__item${current ? ' is-current' : ''}${drag === i ? ' is-drag' : ''}`}
                  draggable
                  onDragStart={() => setDrag(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (drag !== null && drag !== i) {
                      move(drag, i);
                      setDrag(i);
                    }
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  <span className="pl__num">{i + 1}</span>
                  <button type="button" className="pl__play" aria-label={`Play ${it.name} now`} title="Play this one now" onClick={() => playNow(i)}>
                    ▶
                  </button>
                  <input
                    className="text pl__name"
                    value={it.name}
                    aria-label={`Name of video ${i + 1}`}
                    onChange={(e) => setDraft((d) => ({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))}
                  />
                  <span className="pl__len">{it.durationS > 0 ? clock(it.durationS) : '–:––'}</span>
                  {current && <em className="pl__now">NOW</em>}
                  <button type="button" className="icon" aria-label={`Move ${it.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon"
                    aria-label={`Move ${it.name} down`}
                    disabled={i === draft.items.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button type="button" className="icon" aria-label={`Remove ${it.name}`} onClick={() => remove(i)}>
                    <X aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ol>
          {draft.items.length === 0 && <p className="field__note">No videos: Done makes this a single video again.</p>}
          <p className="field__note">Drag to change the order. Lengths appear once a video has been opened.</p>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <span className="remote__spacer" />
          <button type="button" className="btn btn--primary" onClick={save}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
