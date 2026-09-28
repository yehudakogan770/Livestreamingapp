import { useEffect, useRef, useState } from 'react';
import type { Show } from '../engine/types/Show';
import { countdownFinished, countdownRemaining, formatCountdown } from '../engine/timing';
import { useNow } from '../engine/useNow';
import { CountdownDialog, parseLength } from './CountdownDialog';
import type { Act } from './act';

const MIN = 60_000;

/**
 * The countdown at a glance, with what is needed live: start / pause, move to
 * any second (drag the bar, ±10 s, ±1 min, or click the time and type it),
 * and put it in Next. Everything else is under "More…".
 */
export function CountdownCard({ show, act, onPutInNext }: { show: Show; act: Act; onPutInNext?: () => void }) {
  const c = show.countdown;
  const now = useNow(false, c.endsAt !== null ? 100 : 1000);
  const [setup, setSetup] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const frame = useRef(0);
  const pending = useRef<number | null>(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const running = c.endsAt !== null;
  const left = scrub ?? countdownRemaining(c, now);
  const done = countdownFinished(c, now);
  const max = Math.max(c.lengthMs, countdownRemaining(c, now), 1000);
  const moveTo = (ms: number) => act({ type: 'setCountdownRemaining', ms: Math.max(0, Math.round(ms)) });
  const nudge = (ms: number) => act({ type: 'addCountdownTime', ms });
  const shown = formatCountdown(left, c.format === 'auto' ? 'minSec' : c.format);

  return (
    <div className="cd" aria-label="Countdown">
      <div className="cd__top">
        <div className="cd__read">
          <span className="cd__label">{c.label || 'Countdown'}</span>
          {typing === null ? (
            <button
              type="button"
              className={`cd__time${running && left < MIN ? ' is-urgent' : ''}${running ? '' : ' is-paused'}`}
              title="Click to type an exact time"
              onClick={() => setTyping(shown)}
            >
              {shown}
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const ms = parseLength(typing.includes(':') ? typing : `0:${typing}`);
                if (ms !== null) moveTo(ms);
                setTyping(null);
              }}
            >
              <input
                className="cd__type"
                autoFocus
                value={typing}
                aria-label="Time left (m:ss)"
                onChange={(e) => setTyping(e.target.value)}
                onBlur={() => setTyping(null)}
                onKeyDown={(e) => e.key === 'Escape' && setTyping(null)}
              />
            </form>
          )}
        </div>
        <button
          type="button"
          className={`btn cd__go${running && !done ? ' is-on' : ' btn--primary'}`}
          onClick={() => act(running && !done ? { type: 'pauseCountdown' } : done ? { type: 'resetCountdown' } : { type: 'startCountdown' })}
        >
          {running && !done ? 'Pause' : done ? 'Reset' : left < c.lengthMs && left > 0 ? 'Resume' : 'Start'}
        </button>
      </div>
      <input
        className="cd__scrub"
        type="range"
        min={0}
        max={max}
        step={1000}
        value={Math.min(max, left)}
        aria-label="Move the countdown"
        title="Drag to any point"
        onChange={(e) => {
          const v = Number(e.target.value);
          setScrub(v);
          pending.current = v;
          if (!frame.current)
            frame.current = requestAnimationFrame(() => {
              frame.current = 0;
              if (pending.current !== null) moveTo(pending.current);
            });
        }}
        onPointerUp={() => setScrub(null)}
        onKeyUp={() => setScrub(null)}
        onBlur={() => setScrub(null)}
      />
      <div className="cd__row">
        <button type="button" className="seg" onClick={() => nudge(-MIN)}>−1 min</button>
        <button type="button" className="seg" onClick={() => nudge(-10_000)}>−10 s</button>
        <button type="button" className="seg" onClick={() => nudge(10_000)}>+10 s</button>
        <button type="button" className="seg" onClick={() => nudge(MIN)}>+1 min</button>
      </div>
      <div className="cd__row cd__row--jump">
        <span className="cd__jumplabel">Go to last</span>
        <button type="button" className="seg" title="Jump to the last minute" onClick={() => moveTo(MIN)}>1 min</button>
        <button type="button" className="seg" title="Jump to the last 30 seconds" onClick={() => moveTo(30_000)}>30 s</button>
        <button type="button" className="seg" title="Jump to the last 10 seconds" onClick={() => moveTo(10_000)}>10 s</button>
      </div>
      <div className="cd__row">
        {onPutInNext ? (
          <button type="button" className="seg" title="Line the countdown up in Next, then TAKE it" onClick={onPutInNext}>
            Put in Next
          </button>
        ) : (
          <button type="button" className="seg" onClick={() => nudge(5 * MIN)}>+5 min</button>
        )}
        <button type="button" className="seg" onClick={() => act({ type: 'resetCountdown' })}>Reset</button>
        <button type="button" className="seg" onClick={() => setSetup(true)}>More…</button>
      </div>
      {setup && <CountdownDialog show={show} act={act} onClose={() => setSetup(false)} />}
    </div>
  );
}
