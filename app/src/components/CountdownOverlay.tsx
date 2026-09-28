import type { Countdown } from '../engine/types/Countdown';
import { countdownFinished, countdownRemaining, countdownVisible, formatCountdown } from '../engine/timing';
import { useNow } from '../engine/useNow';
import './CountdownOverlay.css';

/**
 * The big countdown, as drawn by a Countdown input (and in its set-up
 * preview). In the last ten seconds every second lands with a pulse; at zero
 * it holds 0, shows the end text, or takes the numbers off, as chosen.
 */
export function CountdownView({ countdown, background, logoUrl }: { countdown: Countdown; background: string; logoUrl?: string | null }) {
  const now = useNow(false, 100);
  const left = countdownRemaining(countdown, now);
  const done = countdownFinished(countdown, now);
  const secs = Math.ceil(left / 1000);
  const final = countdown.endsAt !== null && !done && secs <= 10;
  const text = done && countdown.atZero.type === 'showText' ? countdown.endText : formatCountdown(left, countdown.format);
  return (
    <div className={`hype${final ? ' hype--final' : ''}${done ? ' hype--done' : ''}`} style={{ background: `radial-gradient(ellipse at center, ${background} 0%, #000 140%)` }} data-countdown>
      {!countdownVisible(countdown, now) && logoUrl && <img className="hype__logo" src={logoUrl} alt="" draggable={false} />}
      {countdownVisible(countdown, now) && (
        <>
          {countdown.label && !done && <div className="hype__label">{countdown.label}</div>}
          {/* Keyed by the second so the pulse restarts on each one. */}
          <div key={final ? secs : 'steady'} className={`hype__time${text.length > 8 ? ' hype__time--text' : ''}`}>
            {text}
          </div>
        </>
      )}
    </div>
  );
}
