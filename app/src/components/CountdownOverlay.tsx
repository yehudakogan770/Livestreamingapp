import type { Countdown } from '../engine/types/Countdown';
import { countdownDue, countdownFinished, countdownRemaining, countdownShowsLogo, countdownVisible, formatCountdown } from '../engine/timing';
import { useNow } from '../engine/useNow';
import './CountdownOverlay.css';

/**
 * The big countdown, as drawn by a Countdown input (and in its set-up
 * preview). In the last ten seconds every second lands with a pulse; at zero
 * it holds 0, shows the end text, or takes the numbers off, as chosen.
 */
export function CountdownView({
  countdown,
  background,
  logoUrl,
  onAir = false,
}: {
  countdown: Countdown;
  background: string;
  logoUrl?: string | null;
  /** Still on air on the Live or Back Screen (not taken off at zero). */
  onAir?: boolean;
}) {
  const now = useNow(false, 100);
  const left = countdownRemaining(countdown, now);
  const done = countdownFinished(countdown, now);
  // It lands on 0, holds a moment, then fades to what comes next.
  const after = countdownDue(countdown, now);
  const secs = Math.ceil(left / 1000);
  const final = countdown.endsAt !== null && !done && secs <= 10;
  const words = after && countdown.atZero.type === 'showText';
  const numbersGone = !countdownVisible(countdown, now) || words;
  const time = formatCountdown(left, countdown.format);
  return (
    <div
      className={`hype${final ? ' hype--final' : ''}${done ? ' hype--done' : ''}`}
      style={{ background: `radial-gradient(ellipse at center, ${background} 0%, #000 140%)` }}
      data-countdown
    >
      <div className={`hype__stack${numbersGone ? ' is-gone' : ''}`} aria-hidden={numbersGone}>
        {countdown.label && !done && <div className="hype__label">{countdown.label}</div>}
        {/* Keyed by the second so the pulse restarts on each one. */}
        <div key={final ? secs : done ? 'zero' : 'steady'} className="hype__time">
          {time}
        </div>
      </div>
      {words && <div className="hype__end hype__time hype__time--text">{countdown.endText}</div>}
      {countdownShowsLogo(countdown, now, onAir) && logoUrl && <img className="hype__logo" src={logoUrl} alt="" draggable={false} />}
    </div>
  );
}
