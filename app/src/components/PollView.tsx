import { useMemo } from 'react';
import type { Poll } from '../engine/types/Poll';
import { averageText, countText, ratingAverage, shares } from '../engine/poll';
import { useStage } from '../engine/CountdownContext';
import { joinShown, takesTurns } from '../engine/join';
import { useNow } from '../engine/useNow';
import { CLOUD_COLORS, CloudCache, starFill, starPoints } from '../engine/wordCloud';
import './PollView.css';
import { QrImage } from './QrImage';

function PollJoin({ url, qr, label }: { url: string; qr: string; label: string }) {
  const wifi = useStage()?.event.wifi;
  const now = useNow(false, takesTurns(url, wifi) ? 1000 : 60_000);
  const j = joinShown(url, qr, label, wifi, now);
  return (
    <div className="poll__join">
      <QrImage className="poll__qr" svg={j.qr} />
      <span>{j.label}</span>
      <small>{j.sub}</small>
    </div>
  );
}

/** What the code to scan says for each kind. */
export const JOIN_LABEL: Record<Poll['kind'], string> = { choice: 'Scan to vote', words: 'Scan to add a word', rating: 'Scan to rate' };

/** The cloud's box, in cqh of a 16:9 frame (mirrored in compositor.ts poll()). */
export function cloudBox(join: boolean, questionLines = 1): { w: number; h: number } {
  return { w: 1600 / 9 - 14 - (join ? 40 : 0), h: 100 - 18 - questionLines * 6.4 * 1.15 - 4 - 2 };
}

const cache = new CloudCache();

/** A poll on screen: the question, then bars, a word cloud or stars, and how to join. Mirrored in compositor.ts poll(). */
export function PollView({ p, thumb = false }: { p: Poll; thumb?: boolean }) {
  const kind = p.kind ?? 'choice';
  const join = !!(p.showJoin && p.open && p.joinQr && !thumb);
  return (
    <div className="poll" data-kind="poll">
      <div className={`poll__body${join ? ' poll__body--join' : ''}`}>
        <div className="poll__main">
          <h2 className="poll__q" dir="auto">
            {p.question}
          </h2>
          {kind === 'words' ? <Cloud p={p} join={join} /> : kind === 'rating' ? <Rating p={p} /> : <Choices p={p} />}
        </div>
        {join && <PollJoin url={p.joinUrl} qr={p.joinQr} label={JOIN_LABEL[kind]} />}
      </div>
    </div>
  );
}

function Choices({ p }: { p: Poll }) {
  const share = shares(p);
  return (
    <>
      <ol className="poll__opts">
        {p.options.map((o, i) => (
          <li key={i} className="poll__opt">
            <div className="poll__bar" style={{ width: p.showResults ? `${(share[i] ?? 0) * 100}%` : 0 }} />
            <span className="poll__label" dir="auto">
              {o}
            </span>
            {p.showResults && <span className="poll__pct">{Math.round((share[i] ?? 0) * 100)}%</span>}
          </li>
        ))}
      </ol>
      {p.showResults && <p className="poll__total">{countText(p)}</p>}
    </>
  );
}

function Cloud({ p, join }: { p: Poll; join: boolean }) {
  const box = cloudBox(join);
  const words = p.showResults ? (p.words ?? []) : [];
  const placed = useMemo(() => cache.get(words, box.w, box.h), [words, box.w, box.h]);
  return (
    <>
      <div className="poll__cloud" style={{ width: `${box.w}cqh`, height: `${box.h}cqh` }} aria-label="Word cloud">
        {placed.map((w) => (
          <span
            key={w.text}
            className="poll__word"
            dir="auto"
            style={{ left: `${w.x}cqh`, top: `${w.y}cqh`, fontSize: `${w.size}cqh`, color: CLOUD_COLORS[w.color] }}
          >
            {w.text}
          </span>
        ))}
        {!placed.length && <p className="poll__wait">{p.showResults ? 'The words will appear here.' : 'Send a word or two from your phone.'}</p>}
      </div>
    </>
  );
}

function Star({ fill, size }: { fill: number; size: number }) {
  const pts = starPoints(12, 12, 11.5)
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const id = `s${Math.round(fill * 100)}`;
  return (
    <svg className="poll__star" viewBox="0 0 24 24" style={{ width: `${size}cqh`, height: `${size}cqh` }} aria-hidden="true">
      <defs>
        <clipPath id={id}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      <polygon points={pts} fill="rgba(255,255,255,0.16)" />
      <polygon points={pts} fill="#ffc94d" clipPath={`url(#${id})`} />
    </svg>
  );
}

function Rating({ p }: { p: Poll }) {
  const avg = ratingAverage(p);
  const total = p.votes.reduce((a, b) => a + b, 0);
  const most = Math.max(1, ...p.votes);
  if (!p.showResults)
    return (
      <div className="poll__rating poll__rating--ask">
        <div className="poll__stars">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} fill={0} size={9} />
          ))}
        </div>
        <p className="poll__total">Rate from 1 to 5 stars on your phone.</p>
      </div>
    );
  return (
    <div className="poll__rating">
      <div className="poll__score">
        <span className="poll__avg">{averageText(avg)}</span>
        <div className="poll__stars">
          {starFill(avg).map((f, i) => (
            <Star key={i} fill={f} size={6} />
          ))}
        </div>
        <p className="poll__total">{countText(p)}</p>
      </div>
      <ol className="poll__dist">
        {[4, 3, 2, 1, 0].map((i) => (
          <li key={i}>
            <span className="poll__dist-n">{i + 1}</span>
            <span className="poll__dist-track">
              <span className="poll__dist-bar" style={{ width: `${((p.votes[i] ?? 0) / most) * 100}%` }} />
            </span>
            <span className="poll__dist-c">{total ? Math.round(((p.votes[i] ?? 0) / total) * 100) : 0}%</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
