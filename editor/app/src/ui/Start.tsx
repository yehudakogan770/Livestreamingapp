import { useState } from 'react';
import { forget, recentList } from '../recent';
import { folderOf } from '../native';

/** The first screen: open an event (or carry on with a recent one). */
export function Start({
  problem,
  onChoose,
  onNew,
  onOpen,
}: {
  problem?: string | undefined;
  onChoose: () => void;
  onNew: () => void;
  onOpen: (path: string) => void;
}) {
  const [recent, setRecent] = useState(recentList);
  return (
    <div className="start">
      <div className="start__card">
        <div className="start__main">
          <img className="start__logo" src="./brand/lumora-logo.svg" alt="Lumora Edit" />
          <h1>Make any video</h1>
          <p className="start__lead">
            Start a new project and bring in your videos, music and pictures. Or open an event Lumora recorded (a <b>.lumora</b> file, in Videos → Lumora):
            every camera and microphone is laid out, with the live switching as your first edit.
          </p>
          <div className="start__buttons">
            <button type="button" className="btn btn--primary btn--big start__open" onClick={onNew}>
              New project…
            </button>
            <button type="button" className="btn btn--big start__open" onClick={onChoose}>
              Open…
            </button>
          </div>
          <p className="start__hint">Or drag a project or event file onto this window.</p>
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
