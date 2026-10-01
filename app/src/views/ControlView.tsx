import { branded, hasBrand } from '../engine/brand';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineError, defaultCountdown, isSoundFile, type EngineClient } from '../engine/client';
import type { Action } from '../engine/types/Action';
import type { NewSource } from '../engine/types/NewSource';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { PreviewView, ProgramView } from '../components/ScreenView';
import { SCREENS } from '../components/ScreenSelector';
import { MonitorPanel } from './MonitorPanel';
import { CountdownCard, CountdownMini } from './CountdownCard';
import { PesukimCard } from './PesukimCard';
import { pesukimBar } from '../engine/pesukim';
import { jewishToolsOn } from '../engine/jewishTools';
import { OverlayBar } from './OverlayBar';
import { CameraBar } from './CameraBar';
import { useCommands, type Command } from './commands';
import { ShortcutsDialog } from './ShortcutsDialog';
import { HelpDialog } from './HelpDialog';
import { CueBar, RunOfShowDialog } from './RunOfShow';
import { LibraryDialog } from './LibraryDialog';
import { VisualsPage } from './VisualsPage';
import { LogoMaker } from './LogoMaker';
import { StingerDialog } from './StingerDialog';
import { MidiDialog, useMidiControl } from './MidiDialog';
import { ChatPanel } from './ChatPanel';
import { PerfChip } from '../broadcast/PerfChip';
import { TriggersDialog } from './TriggersDialog';
import { useCopying } from '../engine/copying';
import { snapshot, snapshotName } from '../broadcast/snapshot';
import { CreditsCard } from './CreditsCard';
import { SlideshowCard } from './SlideshowCard';
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
  const copying = useCopying();
  const [adding, setAdding] = useState(false);
  const [addStart, setAddStart] = useState<{ kind?: string; template?: number }>({});
  const [shortcuts, setShortcuts] = useState(false);
  const [help, setHelp] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [visualsOpen, setVisualsOpen] = useState(false);
  const [triggersOpen, setTriggersOpen] = useState(false);
  /** The 3D logo maker: the input being changed (null: a new one). */
  const [logoMaker, setLogoMaker] = useState<{ id: string | null } | null>(null);
  const [stingers, setStingers] = useState(false);
  const [midiOpen, setMidiOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  useCommands(
    useCallback((c: Command) => {
      if (c.type === 'addInput') {
        setAddStart({ kind: c.kind, template: c.template });
        setAdding(true);
      } else if (c.type === 'shortcuts') setShortcuts(true);
      else if (c.type === 'help') setHelp(true);
      else if (c.type === 'runOfShow') setRunOpen(true);
      else if (c.type === 'library') setLibraryOpen(true);
      else if (c.type === 'visuals') setVisualsOpen(true);
      else if (c.type === 'triggers') setTriggersOpen(true);
      else if (c.type === 'midi') setMidiOpen(true);
      else if (c.type === 'chat') setChatOpen((o) => !o);
      else if (c.type === 'logoMaker') setLogoMaker({ id: c.id ?? null });
    }, []),
  );
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [open, setOpen] = useState<ScreenId[]>([]);
  const [showAll, setShowAll] = useState(false);
  const openOutputs = useCallback(() => setOutputsOpen(true), []);
  const activePreset = show.presets.find((p) => p.id === show.activePreset);
  const onlyInputs = !showAll && activePreset && activePreset.sources.length > 0 ? activePreset.sources : null;
  const nextToast = useRef(1);

  const say = useCallback((text: string) => {
    const id = nextToast.current++;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const [snapping, setSnapping] = useState(false);
  const snap = () => {
    if (screen === 'monitor' || snapping) return;
    setSnapping(true);
    const name = snapshotName(screen);
    void snapshot(client, show, screen)
      .then((png) => client.saveSnapshot(png, name))
      .then((where) => say(`Snapshot saved: ${where}`), fail)
      .finally(() => setSnapping(false));
  };
  const fail = useCallback((e: unknown) => {
    const text = e instanceof EngineError ? e.message : e instanceof Error ? e.message : String(e);
    const id = nextToast.current++;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const act: Act = useCallback((a: Action) => void client.dispatch(a).catch(fail), [client, fail]);
  useMidiControl(show, screen, act);

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

  const add = (added: NewSource) => {
    const id = `src-${Date.now().toString(36)}`;
    // New titles come in the event's look.
    const brand = show.event.brand;
    const src: NewSource =
      added.kind.type === 'text' && hasBrand(brand)
        ? { ...added, kind: { ...added.kind, style: branded(added.kind.style, brand, added.kind.layout === 'lowerThird') } }
        : added;
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
      // Ctrl + 1 – 4: TAKE with a favorite transition.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && /^Digit[1-4]$/.test(e.code) && !typing(e.target)) {
        const t = show.settings.favouriteTransitions[Number(e.code.slice(5)) - 1];
        const sc = show.screens[screen];
        if (
          t &&
          screen !== 'monitor' &&
          sc.preview !== null &&
          sc.preview !== sc.program &&
          !adding &&
          !runOpen &&
          !libraryOpen &&
          !visualsOpen &&
          !logoMaker
        ) {
          e.preventDefault();
          act({ type: 'take', screen, transition: t.kind, durationMs: t.durationMs });
        }
        return;
      }
      if (adding || outputsOpen || runOpen || libraryOpen || visualsOpen || logoMaker || triggersOpen || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey)
        return;
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
  }, [act, adding, outputsOpen, runOpen, libraryOpen, visualsOpen, logoMaker, triggersOpen, screen, show]);

  const work = useFitLayout();
  const sc = show.screens[screen];
  const find = (id: string | null) => (id === null ? undefined : show.sources.find((s) => s.id === id));
  const name = SCREENS.find((s) => s.id === screen)?.name ?? '';

  // The controls for what is on air (they stay while it runs), and for what is
  // lined up in Next (as soon as it is there).
  const cardFor = (id: string | null) => {
    const k = find(id)?.kind.type;
    return k === 'pesukim' || k === 'slideshow' || k === 'credits' || k === 'countdown' ? k : null;
  };
  const bar = screen === 'monitor' ? null : pesukimBar(show, screen);
  const cards = [
    ...new Set([cardFor(sc.program), bar ? ('pesukim' as const) : null, sc.preview !== sc.program ? cardFor(sc.preview) : null].filter((c) => c !== null)),
  ];
  const cardView = (card: (typeof cards)[number] | 'none') =>
    card === 'pesukim' ? (
      <PesukimCard key={card} show={show} act={act} screen={screen} client={client} />
    ) : card === 'slideshow' ? (
      <SlideshowCard key={card} show={show} act={act} screen={screen} client={client} />
    ) : card === 'credits' ? (
      <CreditsCard key={card} show={show} act={act} screen={screen} />
    ) : (
      <CountdownMini key="countdown" show={show} act={act} screen={screen} onPutInNext={putCountdownInNext} />
    );

  return (
    <div className="control">
      <div className="control__main">
        <PresetsPanel show={show} client={client} act={act} />
        <div className="control__work" ref={work}>
          {screen === 'monitor' ? (
            <MonitorPanel show={show} act={act} />
          ) : (
            <section className="stage">
              <div className="mon mon--pvw">
                <div className="mon__head">
                  <span className="dot dot--pvw" /> Next <em>{find(sc.preview)?.name ?? 'nothing lined up'}</em>
                </div>
                <div className="mon__fit">
                  <div className="mon__screen">
                    <PreviewView show={show} screen={screen} client={client} />
                    {sc.preview === null && <span className="mon__empty">Click an input below to line it up here</span>}
                  </div>
                </div>
                <div className="mon__foot">
                  <Transport source={find(sc.preview)} act={act} label="Next" />
                  <CameraBar show={show} screen={screen} act={act} client={client} />
                </div>
              </div>
              <div className="centre">
                <SwitchPanel show={show} screen={screen} act={act} onStingers={() => setStingers(true)} />
                <div className="centre__more">{cards.length ? cards.map(cardView) : cardView('none')}</div>
              </div>
              <div className="mon mon--pgm">
                <div className="mon__head">
                  <span className="dot dot--pgm" /> On air <em>{find(sc.program)?.name ?? 'nothing'}</em>
                  <button
                    type="button"
                    className="mon__snap"
                    onClick={snap}
                    disabled={snapping}
                    title="Snapshot: save a picture of this screen as the audience sees it"
                  >
                    {snapping ? '…' : '📷'}
                  </button>
                  <span className="mon__tag">{name.toUpperCase()}</span>
                </div>
                <div className="mon__fit">
                  <div className="mon__screen">
                    <ProgramView show={show} screen={screen} client={client} reportDuration />
                    {screen === 'back' && show.backFollowsLive && <span className="mon__follow">Following the Live Screen</span>}
                    {/* A small tag, not words over the picture: the monitor shows just what the audience sees. */}
                    {(sc.blank || show.panic) && (
                      <span
                        className="mon__state"
                        title={
                          show.panic
                            ? 'Click PANIC (bottom right) to bring the screens back'
                            : `Click “${screen === 'live' ? 'Live' : 'Back'}” next to Blank, or press B, to show it again`
                        }
                      >
                        {show.panic ? 'PANIC on' : 'Blanked'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mon__foot">
                  <Transport source={find(sc.program)} act={act} label="On air" />
                  <OverlayBar show={show} screen={screen} act={act} client={client} />
                </div>
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
        <PerfChip client={client} />
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
        {copying.map((name, i) => (
          <div key={`copy-${i}`} className="toast">
            Copying “{name}” into Lumora… (so it keeps working even if the original is deleted)
          </div>
        ))}
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
          screen={screen}
        />
      )}
      {shortcuts && <ShortcutsDialog jewish={jewishToolsOn(show)} onClose={() => setShortcuts(false)} />}
      {help && <HelpDialog jewish={jewishToolsOn(show)} onClose={() => setHelp(false)} />}
      {runOpen && <RunOfShowDialog show={show} act={act} client={client} onClose={() => setRunOpen(false)} />}
      {chatOpen && <ChatPanel show={show} act={act} client={client} onAdd={add} onClose={() => setChatOpen(false)} />}
      {midiOpen && <MidiDialog onClose={() => setMidiOpen(false)} />}
      {stingers && <StingerDialog show={show} act={act} client={client} onClose={() => setStingers(false)} />}
      {logoMaker && (
        <LogoMaker
          show={show}
          client={client}
          act={act}
          source={show.sources.find((s) => s.id === logoMaker.id && s.kind.type === 'logo3d') ?? null}
          onClose={() => setLogoMaker(null)}
        />
      )}
      {triggersOpen && <TriggersDialog show={show} act={act} onClose={() => setTriggersOpen(false)} />}
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

/**
 * Shares the height between the top (monitors, switch buttons and the card
 * under them) and the inputs and mixer, from what they need: the top gets
 * the larger of the monitors' natural height and the switch panel plus its
 * card, never so much that the inputs lose their room. Re-measured when the
 * window or what is shown changes.
 */
function useFitLayout() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = ref.current;
    if (!w) return;
    let last = '';
    const measure = () => {
      const H = w.clientHeight;
      const W = w.clientWidth;
      const centre = w.querySelector<HTMLElement>('.stage > .center');
      if (!centre) {
        w.style.removeProperty('--stage-h');
        return;
      }
      const sw = centre.querySelector<HTMLElement>('.switch');
      // Every card there (the one on air and the one in Next), with the gap between.
      const shown = [...centre.querySelectorAll<HTMLElement>('.centre__more > *')];
      const switchH = sw?.offsetHeight ?? 0;
      const cardH = shown.length ? shown.reduce((n, c, i) => n + c.scrollHeight + (i ? 10 : 0), 0) + 4 : 0;
      const col = sw?.offsetWidth || 262;
      const monH = (centreW: number) => ((W - centreW - 48) / 2) * (9 / 16) + 86;
      const inputsMin = Math.min(260, Math.max(150, H * 0.26));
      const room = H - inputsMin;
      // Stacked: the card under the switch buttons (bigger monitors).
      const stacked = Math.max(monH(col), 20 + switchH + (cardH ? 10 + cardH : 0));
      // Side by side: the card beside the switch buttons (shorter).
      // (the card column starts 28px down, level with the switch buttons)
      const side = Math.max(monH(col * 2 + 10), 20 + Math.max(switchH, cardH + 28));
      const useSide = cardH > 0 && stacked > room && side < stacked;
      const h = Math.round(Math.max(120, Math.min(useSide ? side : stacked, room)));
      const key = `${h}|${useSide}`;
      if (key !== last) {
        last = key;
        w.style.setProperty('--stage-h', `${h}px`);
        w.classList.toggle('is-side', useSide);
      }
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(w);
    // A card comes or goes (countdown, slides, pesukim…): placed before the
    // screen is drawn, so it never shows in the wrong place first.
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
    mo?.observe(w, { childList: true, subtree: true });
    // Cards that grow or shrink as they run: check a few times a second.
    const id = setInterval(measure, 400);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      clearInterval(id);
    };
  }, []);
  return ref;
}
