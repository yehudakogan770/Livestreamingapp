import { useState } from 'react';
import { forget, recentList } from '../recent';
import { folderOf } from '../native';

/** The first screen: open an event (or carry on with a recent one). */
export function Start({ problem, onChoose, onOpen }: { problem?: string | undefined; onChoose: () => void; onOpen: (path: string) => void }) {
  const [recent, setRecent] = useState(recentList);
  return (
    <div className="start">
      <div className="start__card">
        <div className="start__main">
          <img className="start__logo" src="./brand/lumora-logo.svg" alt="Lumora Edit" />
          <h1>Edit the whole event</h1>
          <p className="start__lead">
            Open the event file Lumora made (it ends in <b>.lumora</b> and sits next to the recording, in Videos → Lumora). Every camera and every microphone is
            laid out on the timeline, with the live switching as your first edit.
          </p>
          <button type="button" className="btn btn--primary btn--big start__open" onClick={onChoose}>
            Open an event…
          </button>
          <p className="start__hint">Or drag the event file onto this window. Double-clicking a .lumora file opens it here too.</p>
          {problem && <p className="start__problem">{problem}</p>}
        </div>
        <div className="start__recent">
          <h2>Recent</h2>
          {recent.length === 0 && <p className="start__empty">Events you open show up here.</p>}
          <ul>
            {recent.map((r) => (
              <li key={r.path}>
                <button type="button" className="start__item" onClick={() => onOpen(r.path)} title={r.path}>
                  <span className="start__name">{r.name}</span>
                  <span className="start__where">{folderOf(r.path)}</span>
                  <span className="start__when">{new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </button>
                <button
                  type="button"
                  className="start__forget"
                  aria-label={`Take ${r.name} off the list`}
                  title="Take off the list"
                  onClick={() => {
                    forget(r.path);
                    setRecent(recentList());
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
