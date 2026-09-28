import { useState } from 'react';
import type { Show } from '../engine/types/Show';
import { countdownFinished, countdownRemaining, formatCountdown } from '../engine/timing';
import { useNow } from '../engine/useNow';
import { CountdownDialog } from './CountdownDialog';
import type { Act } from './act';

const MIN = 60_000;

/** The countdown at a glance, with the controls needed live. Everything else is under "Set up". */
export function CountdownCard({ show, act }: { show: Show; act: Act }) {
  const c = show.countdown;
  const now = useNow(false, c.endsAt !== null ? 100 : 1000);
  const [setup, setSetup] = useState(false);
  const running = c.endsAt !== null;
  const left = countdownRemaining(c, now);
  const done = countdownFinished(c, now);
  return (
    <div className="cd" aria-label="Countdown">
      <div className="cd__top">
        <div className="cd__read">
          <span className="cd__label">{c.label || 'Countdown'}</span>
          <span className={`cd__time${running && left < MIN ? ' is-urgent' : ''}${running ? '' : ' is-paused'}`}>
            {formatCountdown(left, c.format === 'auto' ? 'minSec' : c.format)}
          </span>
        </div>
        <button
          type="button"
          className={`btn cd__go${running && !done ? ' is-on' : ' btn--primary'}`}
          onClick={() =>
            act(running && !done ? { type: 'pauseCountdown' } : done ? { type: 'resetCountdown' } : { type: 'startCountdown' })
          }
        >
          {running && !done ? 'Pause' : done ? 'Reset' : left < c.lengthMs && left > 0 ? 'Resume' : 'Start'}
        </button>
      </div>
      <div className="cd__row">
        <button type="button" className="seg" onClick={() => act({ type: 'addCountdownTime', ms: -MIN })}>
          −1 min
        </button>
        <button type="button" className="seg" onClick={() => act({ type: 'addCountdownTime', ms: MIN })}>
          +1 min
        </button>
        <button type="button" className="seg" onClick={() => act({ type: 'addCountdownTime', ms: 5 * MIN })}>
          +5 min
        </button>
        <button
          type="button"
          className="seg"
          title="Jump to the last 10 seconds"
          onClick={() => act({ type: 'setCountdownRemaining', ms: 10_000 })}
        >
          Last 10s
        </button>
      </div>
      <div className="cd__row">
        <button
          type="button"
          className="seg"
          aria-pressed={c.onLive}
          title="Show the big countdown on the Live Screen"
          onClick={() => act({ type: 'updateCountdown', patch: { onLive: !c.onLive } })}
        >
          On Live
        </button>
        <button
          type="button"
          className="seg"
          aria-pressed={c.onBack}
          title="Show the big countdown on the Back Screen"
          onClick={() => act({ type: 'updateCountdown', patch: { onBack: !c.onBack } })}
        >
          On Back
        </button>
        <button type="button" className="seg" onClick={() => act({ type: 'resetCountdown' })}>
          Reset
        </button>
        <button type="button" className="seg" onClick={() => setSetup(true)}>
          More…
        </button>
      </div>
      {setup && <CountdownDialog show={show} act={act} onClose={() => setSetup(false)} />}
    </div>
  );
}
