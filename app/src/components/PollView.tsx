import type { Poll } from '../engine/types/Poll';
import { shares } from '../engine/poll';
import { useStage } from '../engine/CountdownContext';
import { joinShown, takesTurns } from '../engine/join';
import { useNow } from '../engine/useNow';
import './PollView.css';
import { QrImage } from './QrImage';

function PollJoin({ url, qr }: { url: string; qr: string }) {
  const wifi = useStage()?.event.wifi;
  const now = useNow(false, takesTurns(url, wifi) ? 1000 : 60_000);
  const j = joinShown(url, qr, 'Scan to vote', wifi, now);
  return (
    <div className="poll__join">
      <QrImage className="poll__qr" svg={j.qr} />
      <span>{j.label}</span>
      <small>{j.sub}</small>
    </div>
  );
}

/** A poll on screen: the question, the answers with live bars, and how to vote. Mirrored in compositor.ts poll(). */
export function PollView({ p, thumb = false }: { p: Poll; thumb?: boolean }) {
  const share = shares(p);
  const total = p.votes.reduce((a, b) => a + b, 0);
  const join = p.showJoin && p.open && p.joinQr && !thumb;
  return (
    <div className="poll" data-kind="poll">
      <div className={`poll__body${join ? ' poll__body--join' : ''}`}>
        <div className="poll__main">
          <h2 className="poll__q" dir="auto">
            {p.question}
          </h2>
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
          {p.showResults && (
            <p className="poll__total">
              {total} {total === 1 ? 'vote' : 'votes'}
            </p>
          )}
        </div>
        {join && <PollJoin url={p.joinUrl} qr={p.joinQr} />}
      </div>
    </div>
  );
}
