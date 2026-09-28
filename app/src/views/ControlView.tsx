import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineError, type EngineClient } from '../engine/client';
import type { Action } from '../engine/types/Action';
import type { NewSource } from '../engine/types/NewSource';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { PreviewView, ProgramView } from '../components/ScreenView';
import { SCREENS } from '../components/ScreenSelector';
import { MonitorPanel } from './MonitorPanel';
import { CountdownCard } from './CountdownCard';
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

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));

/** The main event screen for the screen being controlled. */
export function ControlView({ show, screen, client }: { show: Show; screen: ScreenId; client: EngineClient }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [adding, setAdding] = useState(false);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [open, setOpen] = useState<ScreenId[]>([]);
  const nextToast = useRef(1);

  const fail = useCallback((e: unknown) => {
    const text = e instanceof EngineError ? e.message : e instanceof Error ? e.message : String(e);
    const id = nextToast.current++;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const act: Act = useCallback((a: Action) => void client.dispatch(a).catch(fail), [client, fail]);

  useEffect(() => client.watchOutputs(setOpen), [client]);

  const add = (src: NewSource) => {
    const id = `src-${Date.now().toString(36)}`;
    setAdding(false);
    void client
      .dispatch({ type: 'addSource', source: { ...src, id } })
      .then(() => (screen === 'monitor' ? undefined : client.dispatch({ type: 'setPreview', screen, sourceId: id })))
      .catch(fail);
  };

  // Keyboard: Enter TAKE · Shift+Enter CUT · 1–9, 0 line up an input · B blank this screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (adding || outputsOpen || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const sc = show.screens[screen];
      if (e.key === 'Enter' && screen !== 'monitor' && sc.preview !== null && sc.preview !== sc.program) {
        e.preventDefault();
        act(e.shiftKey ? { type: 'take', screen, transition: 'cut' } : { type: 'take', screen });
      } else if (/^[0-9]$/.test(e.key) && screen !== 'monitor') {
        const src = show.sources[e.key === '0' ? 9 : Number(e.key) - 1];
        if (src) act({ type: 'setPreview', screen, sourceId: src.id });
      } else if (e.key === 'b' || e.key === 'B') {
        act({ type: 'setBlank', screens: [screen], value: !sc.blank });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, adding, outputsOpen, screen, show]);

  const sc = show.screens[screen];
  const find = (id: string | null) => (id === null ? undefined : show.sources.find((s) => s.id === id));
  const name = SCREENS.find((s) => s.id === screen)?.name ?? '';
  // Sound comes from the Live output window; until it is open, from here.
  const liveAudioHere = !open.includes('live');

  return (
    <div className="control">
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
            <CountdownCard show={show} act={act} />
          </div>
          <div className="mon mon--pgm">
            <div className="mon__head">
              <span className="dot dot--pgm" /> On air <em>{find(sc.program)?.name ?? 'nothing'}</em>
              <span className="mon__tag">{name.toUpperCase()}</span>
            </div>
            <div className="mon__screen">
              <ProgramView show={show} screen={screen} client={client} audible={screen === 'live' && liveAudioHere} reportDuration />
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
          </div>
        </section>
      )}

      {screen !== 'live' && liveAudioHere && (
        <div hidden aria-hidden>
          <ProgramView show={show} screen="live" client={client} audible />
        </div>
      )}

      {screen !== 'monitor' && (
        <section className="inputs-area">
          <InputGrid show={show} screen={screen} client={client} act={act} onAdd={() => setAdding(true)} />
        </section>
      )}

      <footer className="bar">
        <button type="button" className="btn" onClick={() => setOutputsOpen(true)}>
          Outputs
          <span className="bar__lamps" aria-label={`${open.length} of 3 open`}>
            {SCREENS.map((s) => (
              <i
                key={s.id}
                className={open.includes(s.id) ? 'is-on' : ''}
                title={`${s.name}: ${open.includes(s.id) ? 'open' : 'closed'}`}
              />
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

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>

      {adding && <AddInput client={client} onAdd={add} onClose={() => setAdding(false)} />}
      {outputsOpen && (
        <OutputsDialog show={show} client={client} open={open} act={act} onClose={() => setOutputsOpen(false)} onError={fail} />
      )}
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
