import { useCallback, useEffect, useMemo, useState } from 'react';
import { baseName, createEngineClient, type EventFiles, type RemoteStatus } from './engine/client';
import { useShow } from './engine/useShow';
import { outputScreen } from './engine/role';
import type { ScreenId } from './engine/types/ScreenId';
import { TitleBar, type MenuItem } from './components/TitleBar';
import { TEXT_SIZES, applyTextSize, loadTextSize, stepTextSize, type TextSize } from './components/textSize';
import { ScreenSelector } from './components/ScreenSelector';
import { ControlView } from './views/ControlView';
import { OutputView } from './views/OutputView';
import { EventSetup } from './views/EventSetup';
import { RemoteDialog } from './views/RemoteDialog';
import { defaultPesukim } from './engine/pesukim';
import { BroadcastProvider } from './broadcast/BroadcastContext';
import { BroadcastDialog } from './broadcast/BroadcastDialog';
import { ProblemStore, ProblemsProvider, useReportProblem } from './problems/problems';
import { SafeBoundary } from './components/SafeBoundary';
import { SoundProvider } from './audio/SoundContext';
import { StageContext } from './engine/CountdownContext';
import './App.css';

export function App() {
  const output = useMemo(outputScreen, []);
  return output ? <OutputView screen={output} /> : <Control />;
}

function Control() {
  const [problems] = useState(() => new ProblemStore());
  return (
    <ProblemsProvider store={problems}>
      <ControlApp />
    </ProblemsProvider>
  );
}

function ControlApp() {
  const client = useMemo(createEngineClient, []);
  const { snapshot, error } = useShow(client);
  const [controlling, setControlling] = useState<ScreenId>('live');
  const select = useCallback((id: ScreenId) => setControlling(id), []);
  const show = snapshot?.show ?? null;
  useReportProblem(
    error
      ? {
          key: 'engine',
          level: 'error',
          title: 'Lumora’s engine is not answering',
          detail: error,
          fix: 'Close Lumora and open it again. The show is saved all the time, so it comes back as it was.',
        }
      : null,
  );
  // The event setup opens by itself until it has been answered once, and from the Event menu.
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const showSetup = !!show && (setupOpen || (!show.event.setUp && !setupDismissed));
  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    setSetupDismissed(true);
  }, []);
  const [files, setFiles] = useState<EventFiles>({ current: null, recent: [] });
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [textSize, setTextSize] = useState<TextSize>(loadTextSize);
  useEffect(() => applyTextSize(textSize), [textSize]);
  // Ctrl + / Ctrl − / Ctrl 0, like any app.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') setTextSize((t) => stepTextSize(t, 1));
      else if (e.key === '-') setTextSize((t) => stepTextSize(t, -1));
      else if (e.key === '0') setTextSize('large');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => client.watchEventFiles(setFiles), [client]);
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const openBroadcast = useCallback(() => setBroadcastOpen(true), []);
  useEffect(() => client.watchRemote(setRemote), [client]);
  useReportProblem(
    remote?.enabled && remote.error
      ? {
          key: 'remote',
          level: 'warning',
          title: 'The phone remote could not start',
          detail: remote.error,
          fix: 'Turn it off and on again (Settings → Phone remote). If that does not help, restart the computer.',
          action: { label: 'Phone remote…', run: () => setRemoteOpen(true) },
        }
      : null,
  );
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const fail = useCallback((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)), []);
  const open = useCallback(
    (path?: string) =>
      void client.openEvent(path).then(
        (ok) => ok && setSetupDismissed(true),
        fail,
      ),
    [client, fail],
  );
  const saveAs = useCallback(() => void client.saveEventAs().then((p) => p && setNotice(`Saved. Lumora keeps “${baseName(p)}” up to date from now on.`), fail), [client, fail]);
  const menus = useMemo(() => {
    const event: MenuItem[] = [
      { label: 'Event setup…', onClick: () => setSetupOpen(true) },
      null,
      { label: 'New event', onClick: () => setConfirmNew(true) },
      { label: 'Open event…', onClick: () => open() },
      { label: files.current ? 'Save a copy as…' : 'Save event as…', onClick: saveAs },
    ];
    if (files.recent.length) {
      event.push(null);
      for (const r of files.recent) event.push({ label: `${r === files.current ? '● ' : ''}${baseName(r)}`, hint: r, onClick: () => open(r), disabled: r === files.current });
    }
    const phones = remote?.phones ?? 0;
    const settings: MenuItem[] = [
      { label: 'Recording and streaming…', onClick: openBroadcast },
      {
        label: `Phone remote…${remote?.running ? (phones ? ` (${phones} connected)` : ' (on)') : ''}`,
        onClick: () => setRemoteOpen(true),
      },
      null,
      ...TEXT_SIZES.map((t) => ({ label: `${t.id === textSize ? '● ' : '    '}Text size: ${t.name}`, onClick: () => setTextSize(t.id) })),
    ];
    // 12 Pesukim: line one up in Next (making one if there is none); the card has the rest.
    const screen = controlling === 'monitor' ? 'live' : controlling;
    const pesukim = show?.sources.filter((x) => x.kind.type === 'pesukim') ?? [];
    const putInNext = (id: string) => void client.dispatch({ type: 'setPreview', screen, sourceId: id }).catch(fail);
    const pesukimMenu: MenuItem[] = pesukim.length
      ? pesukim.map((x) => ({ label: `Put “${x.name}” in Next`, onClick: () => putInNext(x.id) }))
      : [
          {
            label: 'Add 12 Pesukim and put it in Next',
            onClick: () => {
              const id = `pesukim-${Date.now().toString(36)}`;
              void client
                .dispatch({ type: 'addSource', source: { id, name: '12 Pesukim', kind: { type: 'pesukim', ...defaultPesukim() } } })
                .then(() => putInNext(id), fail);
            },
          },
        ];
    return { Event: event, Settings: settings, '12 Pesukim': pesukimMenu };
  }, [files, open, saveAs, textSize, remote, openBroadcast, show?.sources, controlling, client, fail]);

  return (
    <div className="app">
      <TitleBar controlling={controlling} eventName={[show?.event.name, files.current ? baseName(files.current) : show ? 'not saved to a file' : ''].filter(Boolean).join(' · ')} menus={menus} />
      <ScreenSelector show={show} selected={controlling} onSelect={select} />
      <main className="workarea">
        {show ? (
          <SafeBoundary audience={false}>
            <SoundProvider show={show} client={client}>
              <StageContext.Provider value={{ event: show.event, mediaUrl: (p) => client.mediaUrl(p), sources: show.sources }}>
                <BroadcastProvider show={show} client={client}>
                  <ControlView show={show} screen={controlling} client={client} onBroadcastSettings={openBroadcast} />
                  {broadcastOpen && <BroadcastDialog client={client} onClose={() => setBroadcastOpen(false)} />}
                </BroadcastProvider>
              </StageContext.Provider>
            </SoundProvider>
          </SafeBoundary>
        ) : (
          <div className="loading">{error ? `The engine did not answer: ${error}` : 'Starting…'}</div>
        )}
      </main>
      {showSetup && show && (
        <StageContext.Provider value={{ event: show.event, mediaUrl: (p) => client.mediaUrl(p), sources: show.sources }}>
          <EventSetup show={show} client={client} onClose={closeSetup} onError={(e) => console.error('Lumora: event setup', e)} />
        </StageContext.Provider>
      )}
      {remoteOpen && remote && <RemoteDialog client={client} status={remote} onClose={() => setRemoteOpen(false)} />}
      {confirmNew && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="New event">
          <div className="modal__box confirm">
            <header className="modal__head">
              <h2>Start a new event?</h2>
            </header>
            <p className="confirm__text">
              {files.current
                ? `“${baseName(files.current)}” is saved and can be opened again from Event → recent.`
                : 'This event has not been saved to a file, so it will be gone. Use “Save event as…” first to keep it.'}
            </p>
            <footer className="modal__foot">
              <button type="button" className="btn" onClick={() => setConfirmNew(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setConfirmNew(false);
                  setSetupDismissed(false);
                  void client.newEvent().catch(fail);
                }}
              >
                Start a new event
              </button>
            </footer>
          </div>
        </div>
      )}
      {notice && (
        <div className="app-notice" role="status">
          {notice}
        </div>
      )}
      {!client.live && (
        <div className="demo-flag" data-testid="engine-status" title="Opened in a browser: changes are not saved">
          browser demo
        </div>
      )}
    </div>
  );
}
