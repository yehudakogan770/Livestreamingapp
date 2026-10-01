import { useEventFonts } from './engine/fonts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dataValues } from './engine/data';
import { appReady, baseName, createEngineClient, type EventFiles, type RemoteStatus } from './engine/client';
import { useShow } from './engine/useShow';
import { isMultiview, outputScreen } from './engine/role';
import { MultiviewView } from './views/MultiviewView';
import type { ScreenId } from './engine/types/ScreenId';
import { TitleBar, type MenuItem } from './components/TitleBar';
import { jewishToolsOn, loadJewishTools, saveJewishTools } from './engine/jewishTools';
import { TEXT_SIZES, applyTextSize, loadTextSize, stepTextSize, type TextSize } from './components/textSize';
import { ScreenSelector } from './components/ScreenSelector';
import { ControlView } from './views/ControlView';
import { OutputView } from './views/OutputView';
import { EventSetup } from './views/EventSetup';
import { BrandDialog } from './views/BrandDialog';
import { ZmanimDialog } from './views/ZmanimDialog';
import { ShabbosGuard } from './views/ShabbosGuard';
import { DataDialog, DataWatcher } from './views/DataDialog';
import { RemoteDialog } from './views/RemoteDialog';
import { barActions, defaultPesukim } from './engine/pesukim';
import { BroadcastProvider } from './broadcast/BroadcastContext';
import { BroadcastDialog } from './broadcast/BroadcastDialog';
import { OverlayEditor } from './views/OverlayEditor';
import { sendCommand } from './views/commands';
import { TEXT_TEMPLATES } from './engine/text';
import { ProblemStore, ProblemsProvider, useReportProblem } from './problems/problems';
import { SafeBoundary } from './components/SafeBoundary';
import { SoundProvider } from './audio/SoundContext';
import { StageContext } from './engine/CountdownContext';
import './App.css';

export function App() {
  const output = useMemo(outputScreen, []);
  const multiview = useMemo(isMultiview, []);
  if (multiview) return <MultiviewView />;
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
  useEventFonts(snapshot?.show.event.brand.fonts, client);
  const [controlling, setControlling] = useState<ScreenId>('live');
  const select = useCallback((id: ScreenId) => setControlling(id), []);
  const show = snapshot?.show ?? null;
  // Once the event has loaded, the loading window gives way to this one.
  // (Or if it could not load: the window shows what went wrong.)
  const loaded = show !== null || !!error;
  useEffect(() => {
    if (loaded) appReady();
  }, [loaded]);
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
  const [brandOpen, setBrandOpen] = useState(false);
  const [zmanimOpen, setZmanimOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
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
  const [jewish, setJewish] = useState(loadJewishTools);
  useEffect(() => saveJewishTools(jewish), [jewish]);
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
  const [overlaysOpen, setOverlaysOpen] = useState(false);
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
  const open = useCallback((path?: string) => void client.openEvent(path).then((ok) => ok && setSetupDismissed(true), fail), [client, fail]);
  const saveAs = useCallback(
    () => void client.saveEventAs().then((p) => p && setNotice(`Saved. Lumora keeps “${baseName(p)}” up to date from now on.`), fail),
    [client, fail],
  );
  const jewishOn = jewishToolsOn(show, jewish);
  const menus = useMemo(() => {
    const event: MenuItem[] = [
      { label: 'Event setup…', onClick: () => setSetupOpen(true) },
      { label: 'Event look (branding)…', onClick: () => setBrandOpen(true) },
      ...(jewishOn ? [{ label: 'Zmanim and Shabbos…', onClick: () => setZmanimOpen(true) }] : []),
      null,
      { label: 'New event', onClick: () => setConfirmNew(true) },
      { label: 'Open event…', onClick: () => open() },
      { label: files.current ? 'Save a copy as…' : 'Save event as…', onClick: saveAs },
    ];
    if (files.recent.length) {
      event.push(null);
      for (const r of files.recent)
        event.push({ label: `${r === files.current ? '● ' : ''}${baseName(r)}`, hint: r, onClick: () => open(r), disabled: r === files.current });
    }
    const phones = remote?.phones ?? 0;
    const settings: MenuItem[] = [
      { label: 'Recording and streaming…', onClick: openBroadcast },
      {
        label: `Phone remote…${remote?.running ? (phones ? ` (${phones} connected)` : ' (on)') : ''}`,
        onClick: () => setRemoteOpen(true),
      },
      { label: 'MIDI controller…', onClick: () => sendCommand({ type: 'midi' }) },
      { label: 'Arrange the screen…', hint: 'Move the parts of this screen around and change their size', onClick: () => sendCommand({ type: 'arrange' }) },
      null,
      ...TEXT_SIZES.map((t) => ({ label: `${t.id === textSize ? '● ' : '    '}Text size: ${t.name}`, onClick: () => setTextSize(t.id) })),
      null,
      {
        label: `${jewish ? '● ' : '    '}Jewish event tools`,
        hint: '12 Pesukim, Tanach & Tehillim, the Hebrew date and zmanim (hidden when off)',
        onClick: () => setJewish((j) => !j),
      },
    ];
    // 12 Pesukim: line one up in Next (making one if there is none); the card has the rest.
    const screen = controlling === 'monitor' ? 'live' : controlling;
    const pesukim = show?.sources.filter((x) => x.kind.type === 'pesukim') ?? [];
    const putInNext = (id: string) => void client.dispatch({ type: 'setPreview', screen, sourceId: id }).catch(fail);
    // The 12 Pesukim go as a bar over the Live screen (an overlay), so the camera stays on.
    const runAll = async (acts: Action[]) => {
      for (const x of acts) await client.dispatch(x);
    };
    const barOn = (id: string, onAir: boolean) => void runAll(barActions(show!, id, screen, onAir)).catch(fail);
    const pesukimMenu: MenuItem[] = pesukim.length
      ? pesukim.flatMap((x) => {
          const ch = show!.overlays.findIndex((o) => o.sourceId === x.id);
          const on = ch >= 0 && show!.overlays[ch]!.on;
          const name = pesukim.length > 1 ? ` (${x.name})` : '';
          return [
            on
              ? {
                  label: `Take the Pesukim bar off${name}`,
                  onClick: () => void client.dispatch({ type: 'setOverlayOn', channel: ch, value: false }).catch(fail),
                }
              : { label: `Show the Pesukim bar on the screen${name}`, onClick: () => barOn(x.id, true) },
            { label: `Get the Pesukim bar ready in Next${name}`, onClick: () => barOn(x.id, false) },
          ];
        })
      : [
          {
            label: 'Add the 12 Pesukim bar (ready in Next)',
            onClick: () => {
              const id = `pesukim-${Date.now().toString(36)}`;
              void client
                .dispatch({ type: 'addSource', source: { id, name: '12 Pesukim', kind: { type: 'pesukim', ...defaultPesukim() } } })
                .then(async () => {
                  const fresh = await client.getShow();
                  await runAll(barActions(fresh.show, id, screen, false));
                })
                .catch(fail);
            },
          },
        ];
    const overlays: MenuItem[] = [
      { label: 'Set up overlays…', onClick: () => setOverlaysOpen(true) },
      {
        label: 'Take every overlay off',
        onClick: () => void client.dispatch({ type: 'overlaysOff' }).catch(fail),
        disabled: !show?.overlays.some((o) => o.on),
      },
    ];
    const inputs: MenuItem[] = [
      { label: 'Add input…', onClick: () => sendCommand({ type: 'addInput' }) },
      { label: '3D logo maker…', onClick: () => sendCommand({ type: 'logoMaker' }) },
      // The 12 Pesukim (only with the Jewish event tools on).
      ...(jewishOn ? [null, ...pesukimMenu] : []),
    ];
    const text: MenuItem[] = [
      ...TEXT_TEMPLATES.map((t, i) => ({
        label: `Add a ${t.name.toLowerCase()}…`,
        hint: t.hint,
        onClick: () => sendCommand({ type: 'addInput', kind: 'text', template: i }),
      })),
      null,
      { label: 'Live chat and audience questions…', onClick: () => sendCommand({ type: 'chat' }) },
      { label: 'Data file (spreadsheet)…', hint: 'Titles and scoreboards take their words from a CSV or JSON file', onClick: () => setDataOpen(true) },
    ];
    const slides = show?.sources.filter((x) => x.kind.type === 'slideshow') ?? [];
    const slideshow: MenuItem[] = [
      { label: 'Add a slideshow…', onClick: () => sendCommand({ type: 'addInput', kind: 'slideshow' }) },
      ...(slides.length ? [null, ...slides.map((x) => ({ label: `Put “${x.name}” in Next`, onClick: () => putInNext(x.id) }))] : []),
    ];
    const timers = show?.sources.filter((x) => x.kind.type === 'countdown') ?? [];
    const timer: MenuItem[] = [
      { label: 'Add a countdown…', onClick: () => sendCommand({ type: 'addInput', kind: 'countdown' }) },
      ...(timers.length ? [null, ...timers.map((x) => ({ label: `Put “${x.name}” in Next`, onClick: () => putInNext(x.id) }))] : []),
    ];
    const presets: MenuItem[] = [
      { label: 'Add a preset…', onClick: () => sendCommand({ type: 'addPreset' }) },
      { label: 'Next preset', onClick: () => void client.dispatch({ type: 'nextPreset' }).catch(fail), disabled: !show?.presets.length },
      { label: 'Previous preset', onClick: () => void client.dispatch({ type: 'previousPreset' }).catch(fail), disabled: !show?.presets.length },
    ];
    const run = show?.run;
    const cues: MenuItem[] = [
      { label: 'Run of show…', onClick: () => sendCommand({ type: 'runOfShow' }) },
      { label: 'Triggers (when this happens, do that)…', onClick: () => sendCommand({ type: 'triggers' }) },
      { label: 'Next cue (N)', onClick: () => void client.dispatch({ type: 'nextCue' }).catch(fail), disabled: !run?.cues.length },
      run?.running
        ? { label: run.paused ? 'Carry on' : 'Hold the show', onClick: () => void client.dispatch({ type: 'pauseShow', value: !run.paused }).catch(fail) }
        : {
            label: 'Start the show',
            onClick: () => void client.dispatch({ type: 'startShow', utcOffsetMin: -new Date().getTimezoneOffset() }).catch(fail),
            disabled: !run?.cues.length,
          },
    ];
    const vis = show?.visuals;
    const visuals: MenuItem[] = [
      { label: 'Stage visuals…', onClick: () => sendCommand({ type: 'visuals' }) },
      null,
      { label: 'Next scene', onClick: () => void client.dispatch({ type: 'visualsStep', step: 1 }).catch(fail) },
      { label: 'One flash', onClick: () => void client.dispatch({ type: 'visualsFlash' }).catch(fail) },
      {
        label: vis?.blackout ? 'Bring the visuals back' : 'Visuals to black',
        onClick: () => void client.dispatch({ type: 'updateVisuals', patch: { blackout: !vis?.blackout } }).catch(fail),
      },
    ];
    const help: MenuItem[] = [
      { label: 'How to use Lumora', onClick: () => sendCommand({ type: 'help' }) },
      { label: 'Keyboard shortcuts', onClick: () => sendCommand({ type: 'shortcuts' }) },
    ];
    return {
      Event: event,
      Presets: presets,
      Cues: cues,
      Library: [{ label: 'Open the library…', onClick: () => sendCommand({ type: 'library' }) }],
      Inputs: inputs,
      Overlays: overlays,
      Text: text,
      Slideshow: slideshow,
      Timer: timer,
      Visuals: visuals,
      Settings: settings,
      Help: help,
    };
  }, [
    files,
    open,
    saveAs,
    textSize,
    jewish,
    jewishOn,
    remote,
    openBroadcast,
    show?.sources,
    show?.overlays,
    show?.presets.length,
    show?.run,
    show?.visuals,
    controlling,
    client,
    fail,
  ]);

  return (
    <div className="app">
      <TitleBar
        controlling={controlling}
        eventName={[show?.event.name, files.current ? baseName(files.current) : show ? 'not saved to a file' : ''].filter(Boolean).join(' · ')}
        menus={menus}
      />
      <ScreenSelector show={show} selected={controlling} onSelect={select} />
      <main className="workarea">
        {show ? (
          <SafeBoundary audience={false}>
            <SoundProvider show={show} client={client}>
              <StageContext.Provider
                value={{ event: show.event, mediaUrl: (p) => client.mediaUrl(p), sources: show.sources, visuals: show.visuals, data: dataValues(show.data) }}
              >
                <BroadcastProvider show={show} client={client}>
                  <ControlView show={show} screen={controlling} client={client} onBroadcastSettings={openBroadcast} />
                  <ShabbosGuard show={show} />
                  <DataWatcher show={show} client={client} />
                  {broadcastOpen && <BroadcastDialog client={client} onClose={() => setBroadcastOpen(false)} />}
                  {overlaysOpen && (
                    <OverlayEditor
                      show={show}
                      channel={0}
                      client={client}
                      act={(a) => void client.dispatch(a).catch(fail)}
                      onClose={() => setOverlaysOpen(false)}
                    />
                  )}
                </BroadcastProvider>
              </StageContext.Provider>
            </SoundProvider>
          </SafeBoundary>
        ) : (
          <div className="loading">{error ? `The engine did not answer: ${error}` : 'Starting…'}</div>
        )}
      </main>
      {showSetup && show && (
        <StageContext.Provider
          value={{ event: show.event, mediaUrl: (p) => client.mediaUrl(p), sources: show.sources, visuals: show.visuals, data: dataValues(show.data) }}
        >
          <EventSetup show={show} client={client} onClose={closeSetup} onError={(e) => console.error('Lumora: event setup', e)} />
        </StageContext.Provider>
      )}
      {dataOpen && show && <DataDialog show={show} client={client} onClose={() => setDataOpen(false)} />}
      {zmanimOpen && show && <ZmanimDialog show={show} act={(a) => void client.dispatch(a).catch(fail)} onClose={() => setZmanimOpen(false)} />}
      {brandOpen && show && <BrandDialog show={show} client={client} onClose={() => setBrandOpen(false)} />}
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
              <button type="button" className="btn" onClick={() => setConfirmNew(false)}>
                Cancel
              </button>
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
