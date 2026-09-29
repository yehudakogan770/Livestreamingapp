import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { TransitionKind } from '../engine/types/TransitionKind';
import type { Act } from './act';

export const KINDS: { kind: TransitionKind; name: string }[] = [
  { kind: 'fade', name: 'Fade' },
  { kind: 'merge', name: 'Merge' },
  { kind: 'dip', name: 'Dip' },
  { kind: 'wipe', name: 'Wipe' },
  { kind: 'slide', name: 'Slide' },
  { kind: 'cut', name: 'Cut' },
  { kind: 'wipeLeft', name: 'Wipe ←' },
  { kind: 'wipeDown', name: 'Wipe ↓' },
  { kind: 'wipeUp', name: 'Wipe ↑' },
  { kind: 'slideRight', name: 'Slide →' },
  { kind: 'slideDown', name: 'Slide ↓' },
  { kind: 'slideUp', name: 'Slide ↑' },
  { kind: 'cover', name: 'Cover' },
  { kind: 'reveal', name: 'Reveal' },
  { kind: 'split', name: 'Doors' },
  { kind: 'splitVertical', name: 'Doors ↕' },
  { kind: 'iris', name: 'Circle' },
  { kind: 'diamond', name: 'Diamond' },
  { kind: 'zoom', name: 'Zoom in' },
  { kind: 'zoomOut', name: 'Zoom out' },
  { kind: 'blur', name: 'Blur' },
  { kind: 'flash', name: 'Flash' },
  { kind: 'lumaClock', name: 'Luma: clock' },
  { kind: 'lumaCircle', name: 'Luma: circle' },
  { kind: 'lumaBlinds', name: 'Luma: blinds' },
  { kind: 'lumaDiagonal', name: 'Luma: diagonal' },
  { kind: 'lumaSparkle', name: 'Luma: sparkle' },
  { kind: 'lumaHeart', name: 'Luma: heart' },
  { kind: 'stinger1', name: 'Stinger 1' },
  { kind: 'stinger2', name: 'Stinger 2' },
];

/** The ones with their own button; the rest are under "More". */
const MAIN = 6;

/** Buttons for the usual transitions and a list with all the others. */
function KindPicker({
  value,
  onPick,
  label,
  onStingers,
}: {
  value: TransitionKind;
  onPick: (k: TransitionKind) => void;
  label: string;
  onStingers?: () => void;
}) {
  const more = KINDS.slice(MAIN);
  const inMore = more.some((k) => k.kind === value);
  return (
    <div className="switch__kinds" role="radiogroup" aria-label={label}>
      {KINDS.slice(0, MAIN).map((k) => (
        <button key={k.kind} type="button" role="radio" aria-checked={value === k.kind} className="seg" onClick={() => onPick(k.kind)}>
          {k.name}
        </button>
      ))}
      <select
        className={`switch__more${inMore ? ' is-on' : ''}`}
        aria-label={`More ${label.toLowerCase()}s`}
        value={inMore ? value : ''}
        onChange={(e) => {
          if (e.target.value === 'setup') onStingers?.();
          else if (e.target.value) onPick(e.target.value as TransitionKind);
        }}
      >
        <option value="">More…</option>
        {more.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.name}
          </option>
        ))}
        {onStingers && <option value="setup">Set up stingers…</option>}
      </select>
    </div>
  );
}

export const DURATIONS = [300, 500, 800, 1200, 2000, 3000];

const secs = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;

/** TAKE, CUT, transition choice and the T-bar for the screen being controlled. */
export function SwitchPanel({ show, screen, act, onStingers }: { show: Show; screen: ScreenId; act: Act; onStingers?: () => void }) {
  const sc = show.screens[screen];
  const t = show.transition;
  const hasPreview = sc.preview !== null && sc.preview !== sc.program;
  return (
    <div className="switch">
      <button
        type="button"
        className="switch__take"
        disabled={!hasPreview}
        onClick={() => act({ type: 'take', screen })}
        title="Send preview to air with the chosen transition (Enter)"
      >
        TAKE <span>· {KINDS.find((k) => k.kind === t.kind)?.name}</span>
      </button>
      <button
        type="button"
        className="switch__cut"
        disabled={!hasPreview}
        onClick={() => act({ type: 'take', screen, transition: 'cut' })}
        title="Send preview to air instantly (Shift+Enter)"
      >
        CUT
      </button>
      <KindPicker label="Transition" value={t.kind} onPick={(kind) => act({ type: 'setTransition', kind })} onStingers={onStingers} />
      <div className="switch__durations" role="radiogroup" aria-label="Transition length">
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={t.durationMs === d}
            className="seg seg--small"
            disabled={t.kind === 'cut'}
            onClick={() => act({ type: 'setTransition', durationMs: d })}
          >
            {secs(d)}
          </button>
        ))}
      </div>
      <TBar show={show} screen={screen} act={act} disabled={!hasPreview} />
      <Favourites show={show} screen={screen} act={act} disabled={!hasPreview} />
      <FadeToBlack show={show} screen={screen} act={act} />
    </div>
  );
}

export const transitionName = (t: { kind: TransitionKind; durationMs: number }) =>
  `${KINDS.find((k) => k.kind === t.kind)?.name ?? t.kind}${t.kind === 'cut' ? '' : ` ${secs(t.durationMs)}`}`;

/** Four favourite transitions: one click takes Next to air with that one. ✎ changes it. */
function Favourites({ show, screen, act, disabled }: { show: Show; screen: ScreenId; act: Act; disabled: boolean }) {
  const [editing, setEditing] = useState<number | null>(null);
  const favs = show.settings.favouriteTransitions;
  const f = editing === null ? null : favs[editing];
  return (
    <div className="switch__favs">
      <span className="switch__label">Favourites</span>
      <div className="switch__favrow">
        {favs.map((t, i) => (
          <div key={i} className="switch__fav">
            <button
              type="button"
              className="seg"
              disabled={disabled}
              title={`TAKE with ${transitionName(t)} (Ctrl+${i + 1})`}
              onClick={() => act({ type: 'take', screen, transition: t.kind, durationMs: t.durationMs })}
            >
              {transitionName(t)}
            </button>
            <button type="button" className="switch__favedit" aria-label={`Change favourite ${i + 1}`} onClick={() => setEditing(editing === i ? null : i)}>
              ✎
            </button>
          </div>
        ))}
      </div>
      {f && editing !== null && (
        <div className="switch__favpick" role="group" aria-label={`Favourite ${editing + 1}`}>
          <KindPicker
            label="Favourite transition"
            value={f.kind}
            onPick={(kind) => act({ type: 'setFavouriteTransition', index: editing, transition: { ...f, kind } })}
          />
          <div className="switch__durations">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className="seg seg--small"
                aria-pressed={f.durationMs === d}
                disabled={f.kind === 'cut'}
                onClick={() => act({ type: 'setFavouriteTransition', index: editing, transition: { ...f, durationMs: d } })}
              >
                {secs(d)}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setEditing(null)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

const FTB_LENGTHS = [1000, 2000, 3000, 5000];

/** Fade to black slowly (and back), with its own length. Blank is the quick one. */
function FadeToBlack({ show, screen, act }: { show: Show; screen: ScreenId; act: Act }) {
  if (screen === 'monitor') return null;
  const black = show.screens[screen].blank;
  const ms = show.settings.fadeToBlackMs;
  return (
    <div className="switch__ftb">
      <button
        type="button"
        className={`btn switch__ftbbtn${black ? ' is-on' : ''}`}
        onClick={() => act({ type: 'fadeToBlack', screen })}
        title={black ? 'Fade back up from black' : 'Fade this screen slowly to black'}
      >
        {black ? 'Fade back up' : 'Fade to black'}
      </button>
      <select value={ms} onChange={(e) => act({ type: 'setFadeToBlackLength', ms: Number(e.target.value) })} aria-label="Fade to black length">
        {(FTB_LENGTHS.includes(ms) ? FTB_LENGTHS : [...FTB_LENGTHS, ms].sort((a, b) => a - b)).map((d) => (
          <option key={d} value={d}>
            {secs(d)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The manual fader. It works from whichever end it is resting at, like a real
 * vision mixer: push it across to complete the mix, and next time pull it back.
 */
function TBar({ show, screen, act, disabled }: { show: Show; screen: ScreenId; act: Act; disabled: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [home, setHome] = useState<Record<ScreenId, 0 | 1>>({ live: 0, back: 0, monitor: 0 });
  const [drag, setDrag] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  // Set once a drag has completed the mix, so it is completed exactly once.
  const done = useRef(false);
  const h = home[screen];
  const value = drag ?? show.screens[screen].tbar;
  const pos = h === 0 ? value : 1 - value;

  const send = useCallback(
    (v: number) => {
      pending.current = v;
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const next = pending.current;
        pending.current = null;
        if (next !== null) act({ type: 'setTbar', screen, value: next });
      });
    },
    [act, screen],
  );
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const valueAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return h === 0 ? x : 1 - x;
  };

  return (
    <div className="tbar">
      <div className="tbar__labels">
        <span>{h === 0 ? 'On air' : 'Next'}</span>
        <span>drag to mix</span>
        <span>{h === 0 ? 'Next' : 'On air'}</span>
      </div>
      <div
        ref={track}
        className={`tbar__track${disabled ? ' is-disabled' : ''}`}
        role="slider"
        aria-label="T-bar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          done.current = false;
          const v = valueAt(e.clientX);
          setDrag(v);
          send(v);
        }}
        onPointerMove={(e) => {
          if (drag === null || done.current) return;
          const v = valueAt(e.clientX);
          if (v >= 0.995) {
            // All the way across: the mix is complete. The engine finishes the
            // take; the fader now rests at this end for the next one.
            done.current = true;
            send(1);
            setHome((m) => ({ ...m, [screen]: h === 0 ? 1 : 0 }));
            setDrag(null);
            return;
          }
          setDrag(v);
          send(v);
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="tbar__fill" style={{ left: h === 0 ? 0 : `${pos * 100}%`, right: h === 0 ? `${(1 - pos) * 100}%` : 0 }} />
        <div className="tbar__handle" style={{ left: `${pos * 100}%` }} />
      </div>
    </div>
  );
}
