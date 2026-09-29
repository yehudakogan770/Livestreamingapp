import type { Fundraiser } from '../engine/types/Fundraiser';
import type { Raffle } from '../engine/types/Raffle';
import { CELEBRATE_MS, confetti, drawAt, money, raised } from '../engine/audience';
import { useNow } from '../engine/useNow';
import './AudienceViews.css';

/** Confetti over the whole frame (the recorder draws the same pieces). */
function Confetti({ t }: { t: number }) {
  if (t <= 0 || t >= 1) return null;
  return (
    <div className="aud__confetti" aria-hidden>
      {confetti(90, t).map((c, i) => (
        <i
          key={i}
          style={{
            left: `${c.x * 100}%`,
            top: `${c.y * 100}%`,
            width: `${c.size * 100}cqh`,
            height: `${c.size * 60}cqh`,
            background: `hsl(${c.hue} 85% 60%)`,
            transform: `rotate(${c.r}rad)`,
          }}
        />
      ))}
    </div>
  );
}

function Join({ url, qr, label }: { url: string; qr: string; label: string }) {
  return (
    <div className="aud__join">
      <div className="aud__qr" dangerouslySetInnerHTML={{ __html: qr }} />
      <span>{label}</span>
      <small>{url.replace(/^http:\/\//, '')}</small>
    </div>
  );
}

/** A raffle on screen: how many entered and how to join, then the draw and the winner. */
export function RaffleView({ r, thumb = false }: { r: Raffle; thumb?: boolean }) {
  const drawing = !!r.draw && Date.now() - r.draw.startedAt < r.draw.durationMs + 6000;
  const now = useNow(drawing && !thumb, 1000);
  const d = drawAt(r, now);
  const join = r.showJoin && r.open && r.joinQr && !thumb;
  const done = d?.done ?? false;
  const since = r.draw ? now - r.draw.startedAt - r.draw.durationMs : 0;
  const earlier = r.winners.slice(0, done ? -1 : r.winners.length - (d ? 1 : 0));
  const nameOf = (id: number) => r.entries.find((e) => e.id === id)?.name ?? '';
  return (
    <div className="aud" data-kind="raffle">
      <div className="aud__head">
        <h2 className="aud__title" dir="auto">
          {r.title}
        </h2>
        {r.prize && (
          <p className="aud__sub" dir="auto">
            {r.prize}
          </p>
        )}
      </div>
      {d ? (
        <div className={`raf__stage${done ? ' is-done' : ''}`}>
          <span className="raf__label">{done ? 'The winner is' : 'Drawing…'}</span>
          <span className="raf__name" dir="auto">
            {d.name}
          </span>
        </div>
      ) : (
        <div className={`raf__wait${join ? ' raf__wait--join' : ''}`}>
          <div className="raf__count">
            <b>{r.entries.length}</b>
            <span>{r.entries.length === 1 ? 'entry' : 'entries'}</span>
          </div>
          {join && <Join url={r.joinUrl} qr={r.joinQr} label="Scan to enter" />}
        </div>
      )}
      {earlier.length > 0 && <p className="raf__earlier">Winners so far: {earlier.map(nameOf).join(' · ')}</p>}
      {done && <Confetti t={since / 5000} />}
    </div>
  );
}

/** A fundraiser on screen: the total against the goal, the latest donors, how to pledge. */
export function FundraiserView({ f, thumb = false }: { f: Fundraiser; thumb?: boolean }) {
  const celebrating = Date.now() - f.celebratedAt < CELEBRATE_MS;
  const now = useNow(celebrating && !thumb, 1000);
  const total = raised(f);
  const pct = Math.min(100, (total / Math.max(1, f.goal)) * 100);
  const donors = f.pledges
    .filter((p) => p.approved)
    .slice(-4)
    .reverse();
  const join = f.showJoin && f.open && f.joinQr && !thumb;
  const t = (now - f.celebratedAt) / CELEBRATE_MS;
  return (
    <div className="aud" data-kind="fundraiser">
      <div className="aud__head">
        <h2 className="aud__title" dir="auto">
          {f.title}
        </h2>
      </div>
      <div className={`fund__body${join ? ' fund__body--join' : ''}`}>
        <div className="fund__main">
          <div className="fund__total">
            <b>{money(f, total)}</b>
            <span>raised of {money(f, f.goal)}</span>
          </div>
          <div className="fund__bar">
            <i style={{ width: `${pct}%` }} />
            <span>{Math.floor(pct)}%</span>
          </div>
          {f.showDonors && donors.length > 0 && (
            <ul className="fund__donors">
              {donors.map((p) => (
                <li key={p.id} dir="auto">
                  <b>{p.name || 'Anonymous'}</b> {money(f, p.amount)}
                  {p.message && <em> · {p.message}</em>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {join && <Join url={f.joinUrl} qr={f.joinQr} label="Scan to pledge" />}
      </div>
      {t > 0 && t < 1 && (
        <>
          <div className="fund__cheer">{pct >= 100 ? 'Goal reached! Thank you!' : `${Math.floor(pct / 25) * 25}% of the goal!`}</div>
          <Confetti t={t} />
        </>
      )}
    </div>
  );
}
