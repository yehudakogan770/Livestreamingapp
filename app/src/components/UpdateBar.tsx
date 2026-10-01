import { useCallback, useEffect, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { isInsideLumora } from '../engine/client';
import './UpdateBar.css';

/** Ask for a check now (Help → Check for updates). */
export function checkForUpdates(): void {
  window.dispatchEvent(new Event('lumora-check-updates'));
}

type State =
  | { s: 'idle' }
  | { s: 'checking'; asked: boolean }
  | { s: 'none' }
  | { s: 'ready'; update: Update }
  | { s: 'getting'; update: Update; done: number; total: number | null }
  | { s: 'error'; message: string };

/**
 * When a new Lumora is out: a bar with "Update now". One click downloads it,
 * installs it and opens Lumora again. Never by itself, so it never happens in
 * the middle of an event. Checks a little after Lumora opens (when online).
 */
export function UpdateBar() {
  const [st, setSt] = useState<State>({ s: 'idle' });
  const [hidden, setHidden] = useState(false);
  const run = useCallback((asked: boolean) => {
    if (!isInsideLumora()) return;
    setHidden(false);
    setSt({ s: 'checking', asked });
    check()
      .then((update) => setSt(update ? { s: 'ready', update } : asked ? { s: 'none' } : { s: 'idle' }))
      .catch((e: unknown) => setSt(asked ? { s: 'error', message: e instanceof Error ? e.message : String(e) } : { s: 'idle' }));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => run(false), 8000);
    const asked = () => run(true);
    window.addEventListener('lumora-check-updates', asked);
    return () => {
      clearTimeout(t);
      window.removeEventListener('lumora-check-updates', asked);
    };
  }, [run]);
  const [current, setCurrent] = useState('');
  useEffect(() => {
    if (isInsideLumora()) void getVersion().then(setCurrent);
  }, []);

  const install = (update: Update) => {
    let done = 0;
    let total: number | null = null;
    setSt({ s: 'getting', update, done, total });
    update
      .downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? null;
        if (e.event === 'Progress') done += e.data.chunkLength;
        setSt({ s: 'getting', update, done, total });
      })
      .then(() => relaunch())
      .catch((e: unknown) => setSt({ s: 'error', message: e instanceof Error ? e.message : String(e) }));
  };

  if (hidden || st.s === 'idle' || (st.s === 'checking' && !st.asked)) return null;
  return (
    <div className="upd" role="status">
      {st.s === 'checking' && <span>Looking for a newer Lumora…</span>}
      {st.s === 'none' && (
        <>
          <span>You have the newest Lumora{current ? ` (${current})` : ''}.</span>
          <button type="button" className="btn" onClick={() => setHidden(true)}>
            OK
          </button>
        </>
      )}
      {st.s === 'ready' && (
        <>
          <span>
            <b>A new Lumora is ready</b> ({st.update.version}). It takes a minute and Lumora opens again by itself. Not during an event.
          </span>
          <button type="button" className="btn btn--primary" onClick={() => install(st.update)}>
            Update now
          </button>
          <button type="button" className="btn" onClick={() => setHidden(true)}>
            Later
          </button>
        </>
      )}
      {st.s === 'getting' && (
        <>
          <span>
            Updating to {st.update.version}…{st.total ? ` ${Math.round((st.done / st.total) * 100)}%` : ''}
          </span>
          <span className="upd__bar">
            <i style={{ width: st.total ? `${(st.done / st.total) * 100}%` : '30%' }} />
          </span>
        </>
      )}
      {st.s === 'error' && (
        <>
          <span>Couldn't update: {st.message}</span>
          <button type="button" className="btn" onClick={() => run(true)}>
            Try again
          </button>
          <button type="button" className="btn" onClick={() => setHidden(true)}>
            Close
          </button>
        </>
      )}
    </div>
  );
}
