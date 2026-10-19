import { Heart, Play, Square, X } from 'lucide-react';
import { useEffect } from 'react';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import type { Reactions } from '../engine/types/Reactions';
import { ReactionsView } from '../components/ReactionsView';
import { compact, REACTIONS } from '../engine/reactions';
import { JoinSetup, useAudienceLink } from './JoinSetup';
import type { Act } from './act';
import './AudienceCards.css';
import './LyricsCard.css';
import './ReactionsCard.css';

/** Run audience reactions: take taps from phones, see the totals, choose where they rise. */
export function ReactionsCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const live = source.kind.type === 'reactions' ? source.kind : null;
  const id = source.id;
  const { remote } = useAudienceLink(client, live, (joinUrl, joinQr) => live && act({ type: 'updateReactions', id, reactions: { ...live, joinUrl, joinQr } }));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!live) return null;
  const update = (patch: Partial<Reactions>) => act({ type: 'updateReactions', id, reactions: { ...live, ...patch } });
  const total = live.counts.reduce((a, b) => a + b, 0);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Reactions" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>
            <Heart className="modal__icon" aria-hidden="true" />
            Reactions · {source.name}
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run" aria-label="Reactions">
            <div className="lyc__stage rxc__stage">
              <ReactionsView r={live} />
            </div>
            <div className="lyc__bar">
              <button
                type="button"
                className={`btn btn--big${live.open ? ' is-on' : ' btn--primary'}`}
                onClick={() => act({ type: 'reactionsOpen', id, value: !live.open })}
                disabled={!remote?.running && !live.open}
              >
                {live.open ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
                {live.open ? 'Stop taking reactions' : 'Take reactions'}
              </button>
              <button type="button" className="btn" disabled={!total} onClick={() => act({ type: 'reactionsReset', id })}>
                Start the totals again
              </button>
            </div>
            <ul className="rxc__totals" aria-label="Totals">
              {REACTIONS.map((r, k) => (
                <li key={r.name}>
                  <span className="rxc__dot" style={{ background: r.color }} aria-hidden="true" />
                  {r.name} <b>{compact(live.counts[k] ?? 0)}</b>
                </li>
              ))}
            </ul>
            <JoinSetup remote={remote} what="react" client={client} act={act} />
          </section>
          <section className="lyc__edit" aria-label="Look">
            <div className="field">
              <span className="field__label">They rise on the</span>
              <span className="segs" role="radiogroup" aria-label="Side">
                {(['left', 'right'] as const).map((side) => (
                  <button key={side} type="button" className="seg" role="radio" aria-checked={live.side === side} onClick={() => update({ side })}>
                    {side === 'left' ? 'Left' : 'Right'}
                  </button>
                ))}
              </span>
            </div>
            <label className="check">
              <input type="checkbox" checked={live.showCounts} onChange={(e) => update({ showCounts: e.target.checked })} /> Show the totals on screen
            </label>
            <label className="check">
              <input type="checkbox" checked={live.showJoin} onChange={(e) => update({ showJoin: e.target.checked })} /> Show a small code to scan while taking
              reactions
            </label>
            <p className="field__note">
              Put this input on an overlay so reactions rise over the cameras. Phones tap Love, Haha, Wow or Yes on the audience page; every tap is counted, and
              a stream of them rises on screen without ever covering the picture for long.
            </p>
          </section>
        </div>
        <footer className="modal__foot">
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
