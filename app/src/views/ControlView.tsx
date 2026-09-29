import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineError, defaultCountdown, isSoundFile, type EngineClient } from '../engine/client';
import type { Action } from '../engine/types/Action';
import type { NewSource } from '../engine/types/NewSource';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { PreviewView, ProgramView } from '../components/ScreenView';
import { SCREENS } from '../components/ScreenSelector';
import { MonitorPanel } from './MonitorPanel';
import { CountdownCard } from './CountdownCard';
import { PesukimCard } from './PesukimCard';
import { OverlayBar } from './OverlayBar';
import { useCommands, type Command } from './commands';
import { ShortcutsDialog } from './ShortcutsDialog';
import { CueBar, RunOfShowDialog } from './RunOfShow';
import { LibraryDialog } from './LibraryDialog';
import { VisualsPage } from './VisualsPage';
import { CreditsCard, creditsTarget } from './CreditsCard';
import { SlideshowCard } from './SlideshowCard';
import { slideshowTarget } from '../engine/slideshow';
import { pesukimTarget } from '../engine/pesukim';
import { Mixer } from './Mixer';
import { PresetsPanel } from './PresetsPanel';
import { PresetButtons } from './PresetButtons';
import { ProblemLight, ProblemToasts } from '../problems/ProblemsUI';
import { BroadcastButtons } from '../broadcast/BroadcastButtons';
import { OutputWatcher, SoundWatcher } from '../problems/watchers';
import { SwitchPanel } from './SwitchPanel';
import { Transport } from './Transport';
import { InputGrid } from './InputGrid';
import { AddInput } from './AddInput';
import { OutputsDialog } from './OutputsDialog';
import type { Act } from './act';
import './ControlView.css';

interface Toast {
  id: number;
  text: string;
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));

/** The main event screen for the screen being controlled. */
export function ControlView({
  show,
  screen,
  client,
  onBroadcastSettings,
}: {
  show: Show;
  screen: ScreenId;
  client: EngineClient;
  /** Open Settings → Recording and streaming. */
  onBroadcastSettings?: () => void;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [adding, setAdding] = useState(false);
  const [addStart, setAddStart] = useState<{ kind?: string; template?: number }>({});
  const [shortcuts, setShortcuts] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [visualsOpen, setVisualsOpen] = useState(false);
  useCommands(
    useCallback((c: Command) => {
      if (c.type === 'addInput') {
        setAddStart({ kind: c.kind, template: c.template });
        setAdding(true);
      } else if (c.type === 'shortcuts') setShortcuts(true);
      else if (c.type === 'runOfShow') setRunOpen(true);
      else if (c.type === 'library') setLibraryOpen(true);
      else if (c.type === 'visuals') setVisualsOpen(true);
    }, []),
  );
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [open, setOpen] = useState<ScreenId[]>([]);
  const [showAll, setShowAll] = useState(false);
  const openOutputs = useCallback(() => setOutputsOpen(true), []);
  const activePreset = show.presets.find((p) => p.id === show.activePreset);
  const onlyInputs = !showAll && activePreset && activePreset.sources.length > 0 ? activePreset.sources : null;
  const nextToast = useRef(1);

  const fail = useCallback((e: unknown) => {
    const text = e instanceof EngineError ? e.message : e instanceof Error ? e.message : String(e);
    const id = nextToast.current++;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const act: Act = useCallback((a: Action) => void client.dispatch(a).catch(fail), [client, fail]);

  useEffect(() => client.watchOutputs(setOpen), [client]);

  // The countdown goes on a screen like any input: lined up in Next, then TAKE.
  // Each countdown input has its own timer, so if every one is already on
  // air a new one is made to prepare in Next without touching the live one.
  const putCountdownInNext = () => {
    const cds = show.sources.filter((s) => s.kind.type === 'countdown');
    const onAir = new Set([show.screens.live.program, show.screens.back.program]);
    const free = cds.find((s) => !onAir.has(s.id));
    if (free) return act({ type: 'setPreview', screen, sourceId: free.id });
    const like = cds[0]?.kind.type === 'countdown' ? cds[0].kind : null;
    const timer = {
      ...defaultCountdown(),
      ...(like
        ? {
            label: like.timer.label,
            endText: like.timer.endText,
            format: like.timer.format,
            atZero: like.timer.atZero,
            lengthMs: like.timer.lengthMs,
            remainingMs: like.timer.lengthMs,
          }
        : {}),
    };
    add({
      name: cds.length ? `Countdown ${cds.length + 1}` : 'Countdown',
      kind: { type: 'countdown', background: like?.background ?? '#0b2545', logo: like?.logo, timer },
    });
  };

  const add = (src: NewSource) => {
    const id = `src-${Date.now().toString(36)}`;
    setAdding(false);
    void client
      .dispatch({ type: 'addSource', source: { ...src, id } })
      .then(() => {
        // Line up new pictures next; sound-only inputs (microphones, music) go to the mixer only.
        const soundOnly = src.kind.type === 'microphone' || (src.kind.type === 'video' && isSoundFile(src.kind.path));
        return screen === 'monitor' || soundOnly ? undefined : client.dispatch({ type: 'setPreview', screen, sourceId: id });
      })
      .catch(fail);
  };

  // Keyboard: Enter TAKE · Shift+Enter CUT · 1–9, 0 line up an input · Shift+1–4 overlays · B blank this screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (adding || outputsOpen || runOpen || libraryOpen || visualsOpen || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const sc = show.screens[screen];
      if (e.key === 'Enter' && screen !== 'monitor' && sc.preview !== null && sc.preview !== sc.program) {
        e.preventDefault();
        act(e.shiftKey ? { type: 'take', screen, transition: 'cut' } : { type: 'take', screen });
      } else if (e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
        // Shift + 1 – 4: overlay on / off.
        const ch = Number(e.code.slice(5)) - 1;
        const o = show.overlays[ch];
        if (o?.sourceId) act({ type: 'setOverlayOn', channel: ch, value: !o.on });
      } else if (/^[0-9]$/.test(e.key) && screen !== 'monitor') {
        const src = show.sources[e.key === '0' ? 9 : Number(e.key) - 1];
        if (src) act({ type: 'setPreview', screen, sourceId: src.id });
      } else if ((e.key === 'n' || e.key === 'N') && show.run.cues.length > 0) {
        act({ type: 'nextCue' });
      } else if (e.key === 'b' || e.key === 'B') {
        act({ type: 'setBlank', screens: [screen], value: !sc.blank });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, adding, outputsOpen, runOpen, libraryOpen, visualsOpen, screen, show]);

  const sc = show.screens[screen];
  const find = (id: string | null) => (id === null ? undefined : show.sources.find((s) => s.id === id));
  const name = SCREENS.find((s) => s.id === screen)?.name ?? '';

  return (
    <div className="control">
      <div className="control__main">
        <PresetsPanel show={show} client={client} act={act} />
        <div className="control__work">
          {screen === 'monitor' ? (
            <MonitorPanel show={show} act={act} />
          ) : (
            <section className="stage">
              <div className="mon mon--pvw">
                <div className="mon__head">
                  <span className="dot dot--pvw" /> Next <em>{find(sc.preview)?.name ?? 'nothing lined up'}</em>
                </div>
                <div className="mon__screen">
                  <PreviewView show={show} screen={screen} client={client} />
                  {sc.preview === null && <span className="mon__empty">Click an input below to line it up here</span>}
                </div>
                <Transport source={find(sc.preview)} act={act} label="Next" />
              </div>
              <div className="centre">
                <SwitchPanel show={show} screen={screen} act={act} />
                {pesukimTarget(show, screen) ? (
                  <PesukimCard show={show} act={act} screen={screen} client={client} />
                ) : slideshowTarget(show, screen) ? (
                  <SlideshowCard show={show} act={act} screen={screen} client={client} />
                ) : creditsTarget(show, screen) ? (
                  <CreditsCard show={show} act={act} screen={screen} />
                ) : (
                  <CountdownCard show={show} act={act} screen={screen} onPutInNext={putCountdownInNext} />
                )}
              </div>
              <div className="mon mon--pgm">
                <div className="mon__head">
                  <span className="dot dot--pgm" /> On air <em>{find(sc.program)?.name ?? 'nothing'}</em>
                  <span className="mon__tag">{name.toUpperCase()}</span>
                </div>
                <div className="mon__screen">
                  <ProgramView show={show} screen={screen} client={client} reportDuration />
                  {screen === 'back' && show.backFollowsLive && <span className="mon__follow">Following the Live Screen</span>}
                  {(sc.blank || show.panic) && (
                    <span className="mon__blanked">
                      {show.panic ? 'PANIC — everything is black' : 'BLANKED — the audience sees black'}
                      <small>
                        {show.panic
                          ? 'Click PANIC (bottom right) to bring the screens back'
                          : `Click “${screen === 'live' ? 'Live' : 'Back'}” next to Blank, or press B, to show it again`}
                      </small>
                    </span>
                  )}
                </div>
                <Transport source={find(sc.program)} act={act} label="On air" />
                <OverlayBar show={show} screen={screen} act={act} client={client} />
              </div>
            </section>
          )}

          {screen !== 'monitor' && (
            <section className="inputs-area">
              <div className="inputs-area__grid">
                <PresetButtons show={show} act={act} showAll={showAll} onShowAll={setShowAll} />
                <InputGrid
                  show={show}
                  screen={screen}
                  client={client}
                  act={act}
                  onAdd={() => {
                    setAddStart({});
                    setAdding(true);
                  }}
                  only={onlyInputs}
                />
              </div>
              <Mixer show={show} act={act} />
            </section>
          )}
        </div>
      </div>

      <footer className="bar">
        <ProblemLight />
        <button type="button" className="btn" onClick={() => setOutputsOpen(true)}>
          Outputs
          <span className="bar__lamps" aria-label={`${open.length} of 3 open`}>
            {SCREENS.map((s) => (
              <i key={s.id} className={open.includes(s.id) ? 'is-on' : ''} title={`${s.name}: ${open.includes(s.id) ? 'open' : 'closed'}`} />
            ))}
          </span>
        </button>
        <button
          type="button"
          className={`btn${show.backFollowsLive ? ' is-on' : ''}`}
          aria-pressed={show.backFollowsLive}
          title="The Back Screen shows whatever is on the Live Screen"
          onClick={() => act({ type: 'setBackFollowsLive', value: !show.backFollowsLive })}
        >
          Back = Live
        </button>
        <BroadcastButtons onSettings={onBroadcastSettings ?? (() => {})} />
        <CueBar show={show} act={act} onOpen={() => setRunOpen(true)} />
        <span className="grow" />
        <span className="bar__label">Blank</span>
        {SCREENS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`btn btn--blank${show.screens[s.id].blank ? ' is-on' : ''}`}
            aria-pressed={show.screens[s.id].blank}
            onClick={() => act({ type: 'setBlank', screens: [s.id], value: !show.screens[s.id].blank })}
          >
            {s.id === 'live' ? 'Live' : s.id === 'back' ? 'Back' : 'Monitor'}
          </button>
        ))}
        <PanicButton on={show.panic} act={act} />
      </footer>

      <SoundWatcher show={show} />
      <OutputWatcher show={show} client={client} open={open} onOpenOutputs={openOutputs} />
      <ProblemToasts />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>

      {adding && (
        <AddInput
          client={client}
          onAdd={add}
          onClose={() => setAdding(false)}
          sources={show.sources}
          initialKind={addStart.kind}
          initialTemplate={addStart.template}
        />
      )}
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
      {runOpen && <RunOfShowDialog show={show} act={act} client={client} onClose={() => setRunOpen(false)} />}
      {visualsOpen && <VisualsPage show={show} act={act} client={client} onClose={() => setVisualsOpen(false)} />}
      {libraryOpen && <LibraryDialog show={show} client={client} act={act} onClose={() => setLibraryOpen(false)} />}
      {outputsOpen && <OutputsDialog show={show} client={client} open={open} act={act} onClose={() => setOutputsOpen(false)} onError={fail} />}
    </div>
  );
}

/** Everything black at once. Needs a double-click so it is never pressed by accident. */
function PanicButton({ on, act }: { on: boolean; act: Act }) {
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), 1800);
    return () => clearTimeout(id);
  }, [hint]);
  return (
    <button
      type="button"
      className={`btn btn--panic${on ? ' is-on' : ''}`}
      aria-pressed={on}
      title={on ? 'Click to bring the screens back' : 'Double-click: everything black, monitor dims'}
      onClick={() => (on ? act({ type: 'panic', value: false }) : setHint(true))}
      onDoubleClick={() => !on && act({ type: 'panic', value: true })}
    >
      {on ? 'PANIC ON · click to undo' : hint ? 'Double-click to confirm' : 'PANIC'}
    </button>
  );
}
