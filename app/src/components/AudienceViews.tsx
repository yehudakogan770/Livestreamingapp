import type { Fundraiser } from '../engine/types/Fundraiser';
import type { Raffle } from '../engine/types/Raffle';
import type { Wall } from '../engine/types/Wall';
import type { WallMessage } from '../engine/types/WallMessage';
import { useEffect, useRef } from 'react';
import { approved, cardSize, tickerShift, wallCard, wallGrid, wallTicker } from '../engine/wall';
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

/** A photo or message card's picture, by file path. */
type Url = (path: string) => string;

function WallText({ m, size }: { m: WallMessage; size: number }) {
  return (
    <div className="wall__words" dir="auto">
      {m.text && (
        <p className="wall__text" style={{ fontSize: `${size}cqh` }}>
          “{m.text}”
        </p>
      )}
      {m.name && <p className="wall__name">— {m.name}</p>}
    </div>
  );
}

/** The ticker: every message running along the bottom, over whatever is behind. */
function WallTicker({ w, thumb }: { w: Wall; thumb: boolean }) {
  const area = useRef<HTMLDivElement>(null);
  const run = useRef<HTMLSpanElement>(null);
  const words = wallTicker(w);
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const a = area.current;
      const r = run.current;
      const frame = a?.closest('.wall')?.clientHeight ?? 0;
      if (a && r && frame) {
        const shift = thumb ? 0 : tickerShift(Date.now(), a.clientWidth / frame, r.scrollWidth / frame);
        r.style.transform = `translateX(${a.clientWidth - shift * frame}px)`;
      }
      if (!thumb) id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [thumb, words]);
  return (
    <div className="wall__ticker">
      <b className="wall__label">{w.title}</b>
      <div className="wall__run" ref={area}>
        <span ref={run} dir="auto">
          {words}
        </span>
      </div>
    </div>
  );
}

/** A messages wall on screen: one at a time, the newest six, or a ticker. */
export function WallView({ w, url, thumb = false }: { w: Wall; url: Url; thumb?: boolean }) {
  const cards = w.style === 'cards' && approved(w).length > 1 && w.pinned === null;
  const now = useNow(cards && !thumb, 250);
  if (w.style === 'ticker') {
    return (
      <div className="wall wall--ticker" data-kind="wall">
        <WallTicker w={w} thumb={thumb} />
      </div>
    );
  }
  const join = w.showJoin && w.open && w.joinQr && !thumb;
  const card = w.style === 'cards' ? wallCard(w, now) : null;
  const grid = w.style === 'grid' ? wallGrid(w) : [];
  const empty = w.style === 'cards' ? !card : !grid.length;
  return (
    <div className="aud wall" data-kind="wall">
      <div className="aud__head">
        <h2 className="aud__title" dir="auto">
          {w.title}
        </h2>
        {join && w.prompt && (
          <p className="aud__sub" dir="auto">
            {w.prompt}
          </p>
        )}
      </div>
      <div className={`wall__area${join ? ' wall__area--join' : ''}`}>
        {empty && <p className="wall__empty">{join ? 'Be the first — scan the code' : 'Messages will appear here'}</p>}
        {card && (
          <div className={`wall__card${card.m.photo ? (card.m.text ? ' wall__card--photo' : ' wall__card--only') : ''}`} style={{ opacity: card.alpha }}>
            {card.m.photo && (
              <div className="wall__photo">
                <img src={url(card.m.photo)} alt="" />
              </div>
            )}
            {card.m.photo && !card.m.text ? (
              card.m.name && (
                <p className="wall__name" dir="auto">
                  — {card.m.name}
                </p>
              )
            ) : (
              <WallText m={card.m} size={cardSize(card.m.text, !!card.m.photo)} />
            )}
          </div>
        )}
        {grid.length > 0 && (
          <div className="wall__grid">
            {grid.map((m) => (
              <div key={m.id} className={`wall__cell${m.photo ? ' wall__cell--photo' : ''}`}>
                {m.photo && <img src={url(m.photo)} alt="" />}
                {m.text && (
                  <p className="wall__celltext" dir="auto">
                    {m.text}
                  </p>
                )}
                {m.name && (
                  <p className="wall__cellname" dir="auto">
                    {m.name}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {join && (
        <div className="wall__join">
          <Join url={w.joinUrl} qr={w.joinQr} label="Scan to send" />
        </div>
      )}
    </div>
  );
}
