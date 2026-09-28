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
];

export const DURATIONS = [300, 500, 800, 1200, 2000, 3000];

const secs = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;

/** TAKE, CUT, transition choice and the T-bar for the screen being controlled. */
export function SwitchPanel({ show, screen, act }: { show: Show; screen: ScreenId; act: Act }) {
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
      <div className="switch__kinds" role="radiogroup" aria-label="Transition">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={t.kind === k.kind}
            className="seg"
            onClick={() => act({ type: 'setTransition', kind: k.kind })}
          >
            {k.name}
          </button>
        ))}
      </div>
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
