import type { Countdown } from '../engine/types/Countdown';
import { countdownFinished, countdownRemaining, countdownShownOn, formatCountdown } from '../engine/timing';
import { useNow } from '../engine/useNow';
import './CountdownOverlay.css';

/**
 * The big countdown over the Live or Back Screen. In the last ten seconds
 * every second lands with a pulse; at zero it holds 0, shows the end text, or
 * leaves the screen, as chosen.
 */
export function CountdownOverlay({ countdown, screen }: { countdown: Countdown; screen: 'live' | 'back' }) {
  const now = useNow(false, 100);
  if (!countdownShownOn(countdown, screen, now)) return null;
  const left = countdownRemaining(countdown, now);
  const done = countdownFinished(countdown, now);
  const secs = Math.ceil(left / 1000);
  const final = countdown.endsAt !== null && !done && secs <= 10;
  const text = done && countdown.atZero.type === 'showText' ? countdown.endText : formatCountdown(left, countdown.format);
  return (
    <div className={`hype${final ? ' hype--final' : ''}${done ? ' hype--done' : ''}`} data-countdown>
      {countdown.label && !done && <div className="hype__label">{countdown.label}</div>}
      {/* Keyed by the second so the pulse restarts on each one. */}
      <div key={final ? secs : 'steady'} className={`hype__time${text.length > 8 ? ' hype__time--text' : ''}`}>
        {text}
      </div>
    </div>
  );
}
