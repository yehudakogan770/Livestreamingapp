import type { Show } from '../engine/types/Show';
import type { TextSize } from '../engine/types/TextSize';
import { FLASH_MS, countdownFinished, countdownRemaining, fadeAmount, formatCountdown } from '../engine/timing';
import { useNow } from '../engine/useNow';
import './MonitorScreen.css';

const SIZE: Record<TextSize, number> = { s: 0.55, m: 0.75, l: 1, xl: 1.3 };

/** The stage monitor: large, readable text for the people on stage. */
export function MonitorScreen({ show }: { show: Show }) {
  const sc = show.screens.monitor;
  const m = show.monitor;
  const c = show.countdown;
  const flashing = Date.now() - sc.flashAt < FLASH_MS;
  const now = useNow(flashing, c.endsAt !== null ? 100 : 500);

  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: !m.clock24h }).formatToParts(new Date(now));
  const time = parts
    .filter((x) => x.type !== 'dayPeriod')
    .map((x) => x.value)
    .join('')
    .trim();
  const period = parts.find((x) => x.type === 'dayPeriod')?.value;

  const left = countdownRemaining(c, now);
  const done = countdownFinished(c, now);
  const urgent = c.endsAt !== null && left < 60_000;
  const timerText = done && c.atZero.type === 'showText' ? c.endText : formatCountdown(left, c.format === 'auto' ? 'minSec' : c.format);

  const message = m.messageOn && m.message ? m.message : null;
  const dark = Math.max(fadeAmount(sc.blank, sc.blankChangedAt, now), fadeAmount(show.panic, show.panicChangedAt, now) * 0.6);
  const flash = now - sc.flashAt < FLASH_MS && Math.floor((now - sc.flashAt) / 300) % 2 === 0;

  const clock = m.showClock && (
    <div className="mscreen__cell mscreen__clock">
      <span className="mscreen__tag">TIME</span>
      <span className="mscreen__num">
        {time}
        {period && <small>{period}</small>}
      </span>
    </div>
  );
  const timer = m.showTimer && (
    <div className={`mscreen__cell mscreen__timer${urgent ? ' is-urgent' : ''}${c.endsAt === null ? ' is-paused' : ''}`}>
      <span className="mscreen__tag">{c.endsAt === null ? 'COUNTDOWN · PAUSED' : 'TIME LEFT'}</span>
      <span className="mscreen__num">{timerText}</span>
    </div>
  );
  const msg = (
    <div className="mscreen__message" style={{ ['--size' as string]: SIZE[m.textSize] }}>
      {message ?? ''}
    </div>
  );

  let body;
  if (m.layout === 'full') {
    body = message ? (
      <div className="mscreen__full">
        {msg}
        {(clock || timer) && (
          <div className="mscreen__strip">
            {clock}
            {timer}
          </div>
        )}
      </div>
    ) : (
      <div className="mscreen__full mscreen__full--idle">
        {clock}
        {timer}
      </div>
    );
  } else {
    body = (
      <div className={`mscreen__${m.layout}`}>
        <div className="mscreen__area">{msg}</div>
        {(clock || timer) && (
          <div className="mscreen__side">
            {clock}
            {timer}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`mscreen${flash ? ' mscreen--flash' : ''}`} data-monitor>
      {body}
      {dark > 0 && <div className="mscreen__dark" style={{ opacity: dark }} />}
    </div>
  );
}
