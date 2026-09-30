import { useState } from 'react';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { countdownTarget, timerOf } from '../engine/countdowns';
import { countdownFinished, countdownRemaining, formatCountdown } from '../engine/timing';
import { useNow } from '../engine/useNow';
import { CountdownDialog, parseLength } from './CountdownDialog';
import type { Act } from './act';

const MIN = 60_000;

/**
 * The countdown at a glance, with what is needed live. It works on the
 * countdown in Next when one is being prepared (changes go only to that
 * one), else on the one on air. Move to any second: drag the bar (applied on
 * release), ±10 s, ±1 min, click the time and type it, go to the last
 * 1 min / 30 s / 10 s. Everything else is under "More…".
 */
export function CountdownCard({ show, act, screen = null, onPutInNext }: { show: Show; act: Act; screen?: ScreenId | null; onPutInNext?: () => void }) {
  const target = countdownTarget(show, screen);
  const c = target ? timerOf(show, target.id) : null;
  const now = useNow(false, c?.endsAt != null ? 100 : 1000);
  const [setup, setSetup] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  if (!target || !c) {
    return (
      <div className="cd cd--none" aria-label="Countdown">
        <span className="cd__label">Countdown</span>
        <span className="cd__hint">No countdown yet.</span>
        {onPutInNext && (
          <button type="button" className="btn btn--primary" onClick={onPutInNext}>
            Make one and put it in Next
          </button>
        )}
      </div>
    );
  }

  const id = target.id;
  const running = c.endsAt !== null;
  const left = scrub ?? countdownRemaining(c, now);
  const done = countdownFinished(c, now);
  const max = Math.max(c.lengthMs, countdownRemaining(c, now), 1000);
  const moveTo = (ms: number) => act({ type: 'setCountdownRemaining', id, ms: Math.max(0, Math.round(ms)) });
  const nudge = (ms: number) => act({ type: 'addCountdownTime', id, ms });
  const shown = formatCountdown(left, c.format === 'auto' ? 'minSec' : c.format);
  const name = show.sources.find((s) => s.id === id)?.name ?? 'Countdown';
  const tag = target.where === 'next' ? 'NEXT' : target.where === 'onAir' ? 'ON AIR' : null;

  return (
    <div className="cd" aria-label="Countdown">
      <div className="cd__top">
        <div className="cd__read">
          <span className="cd__label">
            {tag && <b className={`cd__tag cd__tag--${target.where}`}>{tag}</b>}
            {c.label || name}
          </span>
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
                const ms = typedTime(typing);
                if (ms !== null) moveTo(ms);
                setTyping(null);
              }}
            >
              <input
                className="cd__type"
                autoFocus
                value={typing}
                aria-label="Time left (m:ss, or minutes)"
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
          title={target.where === 'next' ? 'It also starts by itself when you TAKE it' : undefined}
          onClick={() => act(running && !done ? { type: 'pauseCountdown', id } : done ? { type: 'resetCountdown', id } : { type: 'startCountdown', id })}
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
        title="Drag to any point; it moves when you let go"
        // Dragging only previews the time on this card; the countdown moves
        // when the bar is let go, at the time chosen.
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={() => {
          if (scrub !== null) moveTo(scrub);
          setScrub(null);
        }}
        onKeyUp={() => {
          if (scrub !== null) moveTo(scrub);
          setScrub(null);
        }}
        onBlur={() => setScrub(null)}
      />
      <div className="cd__row">
        <button type="button" className="seg" onClick={() => nudge(-MIN)}>
          −1 min
        </button>
        <button type="button" className="seg" onClick={() => nudge(-10_000)}>
          −10 s
        </button>
        <button type="button" className="seg" onClick={() => nudge(10_000)}>
          +10 s
        </button>
        <button type="button" className="seg" onClick={() => nudge(MIN)}>
          +1 min
        </button>
      </div>
      <div className="cd__row cd__row--jump">
        <span className="cd__jumplabel">Go to last</span>
        <button type="button" className="seg" title="Jump to the last minute" onClick={() => moveTo(MIN)}>
          1 min
        </button>
        <button type="button" className="seg" title="Jump to the last 30 seconds" onClick={() => moveTo(30_000)}>
          30 s
        </button>
        <button type="button" className="seg" title="Jump to the last 10 seconds" onClick={() => moveTo(10_000)}>
          10 s
        </button>
      </div>
      <div className="cd__row">
        {onPutInNext ? (
          <button type="button" className="seg" title="Line a countdown up in Next, then TAKE it" onClick={onPutInNext}>
            Put in Next
          </button>
        ) : (
          <button type="button" className="seg" onClick={() => nudge(5 * MIN)}>
            +5 min
          </button>
        )}
        <button type="button" className="seg" onClick={() => act({ type: 'resetCountdown', id })}>
          Reset
        </button>
        <button type="button" className="seg" onClick={() => setSetup(true)}>
          More…
        </button>
      </div>
      {setup && <CountdownDialog show={show} id={id} act={act} onClose={() => setSetup(false)} />}
    </div>
  );
}

/**
 * The countdown on the main page: one line (its time, start / pause), and
 * ▾ opens the whole card. Nothing shows when there is no countdown (the
 * Timer menu adds one).
 */
/** A time typed in: "3:00", "1:15:00", or just minutes ("5"). */
export function typedTime(s: string): number | null {
  const t = s.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60_000);
  return parseLength(t);
}

export function CountdownMini({ show, act, screen, onPutInNext }: { show: Show; act: Act; screen: ScreenId; onPutInNext?: () => void }) {
  const target = countdownTarget(show, screen);
  const c = target ? timerOf(show, target.id) : null;
  const now = useNow(false, c?.endsAt != null ? 250 : 1000);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  if (!target || !c)
    return onPutInNext ? (
      <button
        type="button"
        className="btn btn--small cdm__make"
        aria-label="Make one and put it in Next"
        title="Make a countdown and put it in Next"
        onClick={onPutInNext}
      >
        ⏱ Countdown
      </button>
    ) : null;
  const id = target.id;
  const running = c.endsAt !== null;
  const done = countdownFinished(c, now);
  const shown = formatCountdown(countdownRemaining(c, now), c.format === 'auto' ? 'minSec' : c.format);
  const name = show.sources.find((s) => s.id === id)?.name ?? 'Countdown';
  const tag = target.where === 'next' ? 'NEXT' : target.where === 'onAir' ? 'ON AIR' : null;
  return (
    <div className="cdm" aria-label="Countdown">
      <div className="cdm__row">
        {tag && !open && <b className={`cd__tag cd__tag--${target.where}`}>{tag}</b>}
        <span className="cdm__name">{c.label || name}</span>
        {typing === null ? (
          <button type="button" className={`cdm__time${running ? ' is-running' : ''}`} title="Click to type a time to go to" onClick={() => setTyping(shown)}>
            {shown}
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const ms = typedTime(typing);
              if (ms !== null) act({ type: 'setCountdownRemaining', id, ms: Math.max(0, ms) });
              setTyping(null);
            }}
          >
            <input
              className="cdm__type"
              autoFocus
              value={typing}
              aria-label="Go to this time (m:ss, or minutes)"
              onFocus={(e) => e.target.select()}
              onChange={(e) => setTyping(e.target.value)}
              onBlur={() => setTyping(null)}
              onKeyDown={(e) => e.key === 'Escape' && setTyping(null)}
            />
          </form>
        )}
        <button
          type="button"
          className="btn btn--small"
          onClick={() => act(running && !done ? { type: 'pauseCountdown', id } : done ? { type: 'resetCountdown', id } : { type: 'startCountdown', id })}
        >
          {running && !done ? 'Pause' : done ? 'Reset' : 'Start'}
        </button>
        <button type="button" className="btn btn--small" aria-expanded={open} aria-label="All countdown controls" onClick={() => setOpen(!open)}>
          {open ? '▴' : '▾'}
        </button>
      </div>
      {open && <CountdownCard show={show} act={act} screen={screen} onPutInNext={onPutInNext} />}
    </div>
  );
}
