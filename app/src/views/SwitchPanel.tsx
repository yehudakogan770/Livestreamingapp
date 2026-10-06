import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Aperture,
  Blend,
  ChevronDown,
  Columns2,
  Diamond,
  Film,
  Merge,
  Moon,
  PanelLeftOpen,
  PanelRightOpen,
  Scissors,
  SlidersHorizontal,
  Sparkle,
  SunDim,
  Waves,
  Zap,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { OVERLAY_KINDS } from '../engine/overlays';
import { isSoundFile } from '../engine/client';
import { screenInputs } from '../engine/screenInputs';
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

/** A small line glyph for each kind of transition. */
export function transitionIcon(kind: TransitionKind): LucideIcon {
  if (kind === 'cut') return Scissors;
  if (kind === 'fade') return Blend;
  if (kind === 'merge') return Merge;
  if (kind === 'dip') return SunDim;
  if (kind === 'flash') return Zap;
  if (kind === 'blur') return Waves;
  if (kind === 'zoom') return ZoomIn;
  if (kind === 'zoomOut') return ZoomOut;
  if (kind === 'iris') return Aperture;
  if (kind === 'diamond') return Diamond;
  if (kind === 'split' || kind === 'splitVertical') return Columns2;
  if (kind === 'cover') return PanelLeftOpen;
  if (kind === 'reveal') return PanelRightOpen;
  if (kind === 'stinger1' || kind === 'stinger2') return Film;
  if (kind.startsWith('luma')) return Sparkle;
  if (kind === 'wipeLeft') return ArrowLeft;
  if (kind === 'wipeDown' || kind === 'slideDown') return ArrowDown;
  if (kind === 'wipeUp' || kind === 'slideUp') return ArrowUp;
  return ArrowRight;
}

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
          <TransitionGlyph kind={k.kind} />
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

/**
 * TAKE, CUT, the T-bar and the four favorite transitions — the everyday
 * controls. The transition choice is one button that opens everything
 * else (every transition, lengths, the favorites, Fade to black's length).
 */
export function SwitchPanel({ show, screen, act, onStingers }: { show: Show; screen: ScreenId; act: Act; onStingers?: () => void }) {
  const sc = show.screens[screen];
  const t = show.transition;
  const hasPreview = sc.preview !== null && sc.preview !== sc.program;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The panel floats over the page next to its button (the center column scrolls and would cut it off).
  const [at, setAt] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const width = Math.max(r.width, 320);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const top = r.bottom + 6;
    setAt({ position: 'fixed', left: Math.max(8, left), top, width, maxHeight: window.innerHeight - top - 70, overflowY: 'auto' });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const Glyph = transitionIcon(t.kind);
  return (
    <div className="switch">
      <div className="phead switch__head">
        <SlidersHorizontal aria-hidden="true" />
        <span className="phead__title">Switcher</span>
        <span className="phead__meta">{screen === 'live' ? 'LIVE' : screen === 'back' ? 'BACK' : 'MON'}</span>
      </div>
      <div className="switch__body">
        <Buses show={show} screen={screen} act={act} />
        <div className="switch__keys">
          <button
            type="button"
            className="switch__cut"
            disabled={!hasPreview}
            onClick={() => act({ type: 'take', screen, transition: 'cut' })}
            title="Send preview to air instantly (Shift+Enter)"
          >
            CUT
          </button>
          <button
            type="button"
            className="switch__take"
            disabled={!hasPreview}
            onClick={() => act({ type: 'take', screen })}
            title="Send preview to air with the chosen transition (Enter)"
          >
            TAKE <span>{transitionName(t)}</span>
          </button>
        </div>
        <div className="switch__row" ref={box}>
          <button
            type="button"
            className={`btn switch__trans${open ? ' is-on' : ''}`}
            aria-expanded={open}
            aria-label="Transition"
            title="Choose the transition and its length"
            onClick={() => setOpen(!open)}
          >
            <Glyph aria-hidden="true" />
            <span>{transitionName(t)}</span>
            <ChevronDown className="switch__caret" aria-hidden="true" />
          </button>
          <FadeToBlack show={show} screen={screen} act={act} />
          {open && (
            <div className="switch__pop" role="dialog" aria-label="Transition choices" style={at}>
              <span className="switch__label">Transition</span>
              <KindPicker label="Transition" value={t.kind} onPick={(kind) => act({ type: 'setTransition', kind })} onStingers={onStingers} />
              <span className="switch__label">Length</span>
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
              <FavouritesEditor show={show} act={act} />
              <FadeLength show={show} act={act} />
            </div>
          )}
        </div>
        <TBar show={show} screen={screen} act={act} disabled={!hasPreview} />
        <Favourites show={show} screen={screen} act={act} disabled={!hasPreview} />
      </div>
    </div>
  );
}

function TransitionGlyph({ kind }: { kind: TransitionKind }) {
  const G = transitionIcon(kind);
  return <G className="glyph" aria-hidden="true" />;
}

/** Key-cap names for the bus keys (brackets of placeholders dropped). */
const capName = (name: string) => name.replace(/[[\]]/g, '').trim();

/**
 * The program and preview buses, as on a hardware switcher: one key per
 * picture input. A Program key cuts it straight to air; a Preview key lines
 * it up in Next. Names and titles (overlays) and sound-only inputs are not here.
 */
function Buses({ show, screen, act }: { show: Show; screen: ScreenId; act: Act }) {
  const sc = show.screens[screen];
  const keys = screenInputs(show, screen)
    .map((src, i) => ({ src, n: i + 1 }))
    .filter(({ src }) => !OVERLAY_KINDS.has(src.kind.type) && src.kind.type !== 'microphone' && !(src.kind.type === 'video' && isSoundFile(src.kind.path)));
  if (keys.length === 0) return null;
  const row = (bus: 'pgm' | 'pvw') => (
    <div className={`bus__row bus__row--${bus}`} role="group" aria-label={bus === 'pgm' ? 'Program bus' : 'Preview bus'}>
      <span className="bus__label">{bus === 'pgm' ? 'PGM' : 'PVW'}</span>
      <div className="bus__keys">
        {keys.map(({ src, n }) => {
          const on = (bus === 'pgm' ? sc.program : sc.preview) === src.id;
          return (
            <button
              key={src.id}
              type="button"
              className={`bus__key${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={`${bus === 'pgm' ? 'Program' : 'Preview'} ${n}: ${src.name}`}
              title={`${n} · ${src.name}: ${bus === 'pgm' ? 'cut straight to air' : 'line up in Next'}`}
              onClick={() => act(bus === 'pgm' ? { type: 'cutTo', screen, sourceId: src.id } : { type: 'setPreview', screen, sourceId: src.id })}
            >
              <b>{n}</b>
              <small>{capName(src.name)}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <div
      className="bus"
      role="group"
      aria-label="Program and preview buses"
      style={{ '--bus-cols': Math.min(6, Math.max(4, keys.length)) } as React.CSSProperties}
    >
      {row('pgm')}
      {row('pvw')}
    </div>
  );
}

export const transitionName = (t: { kind: TransitionKind; durationMs: number }) =>
  `${KINDS.find((k) => k.kind === t.kind)?.name ?? t.kind}${t.kind === 'cut' ? '' : ` ${secs(t.durationMs)}`}`;

/** Four favorite transitions: one click takes Next to air with that one. */
function Favourites({ show, screen, act, disabled }: { show: Show; screen: ScreenId; act: Act; disabled: boolean }) {
  return (
    <div className="switch__favrow" role="group" aria-label="Favorites">
      {show.settings.favouriteTransitions.map((t, i) => (
        <button
          key={i}
          type="button"
          className="seg seg--small"
          disabled={disabled}
          title={`TAKE with ${transitionName(t)} (Ctrl+${i + 1}) — change these under the transition button`}
          onClick={() => act({ type: 'take', screen, transition: t.kind, durationMs: t.durationMs })}
        >
          <TransitionGlyph kind={t.kind} />
          {KINDS.find((k) => k.kind === t.kind)?.name ?? t.kind}
        </button>
      ))}
    </div>
  );
}

/** Change the four favorite buttons. */
function FavouritesEditor({ show, act }: { show: Show; act: Act }) {
  const [editing, setEditing] = useState<number | null>(null);
  const favs = show.settings.favouriteTransitions;
  const f = editing === null ? null : favs[editing];
  return (
    <div className="switch__favs">
      <span className="switch__label">Favorite buttons — click one to change it</span>
      <div className="switch__favrow">
        {favs.map((t, i) => (
          <button
            key={i}
            type="button"
            className="seg seg--small"
            aria-pressed={editing === i}
            aria-label={`Change favorite ${i + 1}`}
            onClick={() => setEditing(editing === i ? null : i)}
          >
            {transitionName(t)}
          </button>
        ))}
      </div>
      {f && editing !== null && (
        <div className="switch__favpick" role="group" aria-label={`Favorite ${editing + 1}`}>
          <KindPicker
            label="Favorite transition"
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
        </div>
      )}
    </div>
  );
}

const FTB_LENGTHS = [1000, 2000, 3000, 5000];

/** Fade to black slowly (and back). Blank is the quick one; its length is under the transition button. */
function FadeToBlack({ show, screen, act }: { show: Show; screen: ScreenId; act: Act }) {
  if (screen === 'monitor') return null;
  const black = show.screens[screen].blank;
  return (
    <button
      type="button"
      className={`btn switch__ftbbtn${black ? ' is-on' : ''}`}
      onClick={() => act({ type: 'fadeToBlack', screen })}
      title={black ? 'Fade back up from black' : `Fade this screen slowly to black (${secs(show.settings.fadeToBlackMs)})`}
    >
      <Moon aria-hidden="true" />
      {black ? 'Fade up' : 'FTB'}
    </button>
  );
}

function FadeLength({ show, act }: { show: Show; act: Act }) {
  const ms = show.settings.fadeToBlackMs;
  return (
    <label className="switch__ftblen">
      <span className="switch__label">Fade to black takes</span>
      <select value={ms} onChange={(e) => act({ type: 'setFadeToBlackLength', ms: Number(e.target.value) })} aria-label="Fade to black length">
        {(FTB_LENGTHS.includes(ms) ? FTB_LENGTHS : [...FTB_LENGTHS, ms].sort((a, b) => a - b)).map((d) => (
          <option key={d} value={d}>
            {secs(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The manual fader. Push it across from the left to mix to Next; when the
 * mix is complete it springs back to the left, ready for the next one.
 */
function TBar({ show, screen, act, disabled }: { show: Show; screen: ScreenId; act: Act; disabled: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  // Set once a drag has completed the mix, so it is completed exactly once.
  const done = useRef(false);
  const pos = drag ?? show.screens[screen].tbar;

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
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  return (
    <div className="tbar">
      <div className="tbar__labels">
        <span>On air</span>
        <span>drag to mix</span>
        <span>Next</span>
      </div>
      <div
        ref={track}
        className={`tbar__track${disabled ? ' is-disabled' : ''}${drag === null ? ' is-resting' : ''}`}
        role="slider"
        aria-label="T-bar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos * 100)}
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
            // take, and the fader springs back to the left.
            done.current = true;
            send(1);
            setDrag(null);
            return;
          }
          setDrag(v);
          send(v);
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="tbar__fill" style={{ left: 0, right: `${(1 - pos) * 100}%` }} />
        <div className="tbar__handle" style={{ left: `${pos * 100}%` }} />
      </div>
    </div>
  );
}
