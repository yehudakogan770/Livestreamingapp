import type { CSSProperties } from 'react';
import type { Scoreboard } from '../engine/types/Scoreboard';
import type { Team } from '../engine/types/Team';
import { clockShown, formatGameClock } from '../engine/score';
import { useNow } from '../engine/useNow';
import './ScoreboardView.css';

/** px of a 1080-high frame, in container units (every screen and preview matches). */
const u = (px: number) => `${(px / 1080) * 100}cqh`;

/**
 * A scoreboard: see-through except the board, so it sits over the game as
 * an overlay. The same layout is drawn by the recorder (compositor.ts).
 */
export function ScoreboardView({ sb }: { sb: Scoreboard }) {
  const running = sb.clock.since !== null;
  const now = useNow(false, running ? 100 : 1000);
  const clock = formatGameClock(clockShown(sb.clock, now), sb.clock.countDown);
  const info = (sb.period || sb.showClock) && (
    <div className="sb__info">
      {sb.showClock && <span className="sb__clock">{clock}</span>}
      {sb.period && <span className="sb__period">{sb.period}</span>}
    </div>
  );
  if (sb.style === 'full') {
    const side = (t: Team) => (
      <div className="sbf__team">
        <i style={{ background: t.color, height: u(12) }} />
        <span className="sbf__name" style={{ fontSize: u(64) }}>
          {t.name}
        </span>
        <span className="sbf__score" style={{ fontSize: u(260) }}>
          {t.score}
        </span>
      </div>
    );
    return (
      <div className="sb sb--full" data-kind="scoreboard">
        {sb.title && (
          <div className="sbf__title" style={{ fontSize: u(48), top: u(70) }}>
            {sb.title}
          </div>
        )}
        <div className="sbf__row">
          {side(sb.home)}
          <div className="sbf__mid">
            {sb.showClock && (
              <span className="sb__clock" style={{ fontSize: u(96) }}>
                {clock}
              </span>
            )}
            {sb.period && (
              <span className="sb__period" style={{ fontSize: u(44) }}>
                {sb.period}
              </span>
            )}
          </div>
          {side(sb.away)}
        </div>
      </div>
    );
  }
  const bar = sb.style === 'bar';
  const vars = {
    '--sb-h': u(bar ? 76 : 56),
    '--sb-name': u(bar ? 34 : 28),
    '--sb-score': u(bar ? 46 : 34),
    '--sb-strip': u(bar ? 10 : 8),
    '--sb-pad': u(bar ? 20 : 14),
    '--sb-scorew': u(bar ? 84 : 60),
    '--sb-clock': u(bar ? 34 : 28),
    '--sb-period': u(bar ? 22 : 18),
    '--sb-r': u(6),
  } as CSSProperties;
  const team = (t: Team, end: boolean) => (
    <div className={`sb__team${end ? ' sb__team--end' : ''}`}>
      <i className="sb__strip" style={{ background: t.color }} />
      <span className="sb__name">{bar ? t.name : t.short || t.name}</span>
      <span className="sb__score">{t.score}</span>
    </div>
  );
  return (
    <div className={`sb sb--${sb.style}`} data-kind="scoreboard">
      <div className="sb__board" style={vars}>
        {team(sb.home, false)}
        {bar && info}
        {team(sb.away, bar)}
        {!bar && info}
      </div>
    </div>
  );
}
