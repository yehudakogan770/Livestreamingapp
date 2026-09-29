import type { Poll } from '../engine/types/Poll';
import { shares } from '../engine/poll';
import './PollView.css';

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
        {join && (
          <div className="poll__join">
            <div className="poll__qr" dangerouslySetInnerHTML={{ __html: p.joinQr }} />
            <span>Scan to vote</span>
            <small>{p.joinUrl.replace(/^http:\/\//, '')}</small>
          </div>
        )}
      </div>
    </div>
  );
}
