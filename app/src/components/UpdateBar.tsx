import { useCallback, useEffect, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { BrandMark } from './Logo';
import './UpdateBar.css';
import { useFeature } from '../auth/accessContext';

const isInsideLumora = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Streaming or recording right now (false where that can't be asked, like Lumora Studio). */
async function sendingNow(): Promise<boolean> {
  try {
    const s = await invoke<{ recording: unknown; streaming: unknown; vertical?: unknown }>('capture_status');
    return !!(s.recording || s.streaming || s.vertical);
  } catch {
    return false;
  }
}

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
export function UpdateBar({ product = 'Lumora' }: { product?: string }) {
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
  // The Lumora team can turn off the automatic prompt (Features); “Check for updates” still works.
  const auto = useFeature('update_prompt');
  useEffect(() => {
    const t = auto ? setTimeout(() => run(false), 8000) : undefined;
    const asked = () => run(true);
    window.addEventListener('lumora-check-updates', asked);
    return () => {
      clearTimeout(t);
      window.removeEventListener('lumora-check-updates', asked);
    };
  }, [run, auto]);
  const [current, setCurrent] = useState('');
  useEffect(() => {
    if (isInsideLumora()) void getVersion().then(setCurrent);
  }, []);

  const install = async (update: Update) => {
    // Updating closes Lumora: never while the stream or a recording runs.
    if (await sendingNow()) {
      setSt({ s: 'error', message: 'Stop the stream and the recording first (updating closes Lumora).' });
      return;
    }
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
      <BrandMark size={18} of={product === 'Lumora Studio' ? 'studio' : 'lumora'} className="upd__mark" />
      {st.s === 'checking' && <span>Looking for a newer {product}…</span>}
      {st.s === 'none' && (
        <>
          <span>
            You have the newest {product}
            {current ? ` (${current})` : ''}.
          </span>
          <button type="button" className="btn" onClick={() => setHidden(true)}>
            OK
          </button>
        </>
      )}
      {st.s === 'ready' && (
        <>
          <span>
            <b>A new {product} is ready</b> ({st.update.version}). It takes a minute and {product} opens again by itself.
            {product === 'Lumora' ? ' Not during an event.' : ''}
          </span>
          <button type="button" className="btn btn--primary" onClick={() => void install(st.update)}>
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
