import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import { JoinSetup, useAudienceLink } from './JoinSetup';
import './AudienceCards.css';
import type { Poll } from '../engine/types/Poll';
import type { Source } from '../engine/types/Source';
import { PollView } from '../components/PollView';
import type { Act } from './act';
import './LyricsCard.css';

/** Run an audience poll: open voting, watch the results come in, show them. */
export function PollCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const live = source.kind.type === 'poll' ? source.kind : null;
  const [draft, setDraft] = useState<Poll | null>(() => (live ? structuredClone(live) : null));
  // Keep the code on screen pointing at the current address.
  const { remote } = useAudienceLink(client, live, (joinUrl, joinQr) => live && act({ type: 'updatePoll', id: source.id, poll: { ...live, joinUrl, joinQr } }));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!live || !draft) return null;

  const id = source.id;
  const total = live.votes.reduce((a, b) => a + b, 0);
  const options = draft.options.join('\n');
  const dirty = draft.question !== live.question || options !== live.options.join('\n');
  const save = () => act({ type: 'updatePoll', id, poll: { ...live, question: draft.question, options: draft.options.filter((o) => o.trim()) } });

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Poll" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>Poll · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run" aria-label="Results">
            <div className="lyc__stage">
              <PollView p={live} />
            </div>
            <div className="lyc__bar">
              <button
                type="button"
                className={`btn btn--big${live.open ? ' is-on' : ' btn--primary'}`}
                onClick={() => act({ type: 'pollOpen', id, value: !live.open })}
                disabled={!remote?.running && !live.open}
              >
                {live.open ? '■ Stop voting' : '▶ Start voting'}
              </button>
              <label className="check">
                <input type="checkbox" checked={live.showResults} onChange={(e) => act({ type: 'pollShowResults', id, value: e.target.checked })} /> Show the
                results on screen
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={live.showJoin}
                  onChange={(e) => act({ type: 'updatePoll', id, poll: { ...live, showJoin: e.target.checked } })}
                />{' '}
                Show the code to scan
              </label>
            </div>
            <p className="field__note">
              {total} {total === 1 ? 'vote' : 'votes'} so far.
            </p>
            <JoinSetup remote={remote} what="vote" client={client} act={act} />
          </section>
          <section className="lyc__edit" aria-label="Question">
            <label className="field">
              <span className="field__label">Question</span>
              <input
                className="text"
                dir="auto"
                value={draft.question}
                onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                aria-label="Question"
              />
            </label>
            <label className="field">
              <span className="field__label">Answers, one on each line (changing them starts the votes again)</span>
              <textarea
                className="text lyc__text"
                dir="auto"
                rows={6}
                value={options}
                onChange={(e) => setDraft({ ...draft, options: e.target.value.split('\n').slice(0, 8) })}
                aria-label="Answers"
              />
            </label>
            <div className="lyc__row">
              <button type="button" className="btn btn--primary" disabled={!dirty} onClick={save}>
                Save question
              </button>
              <button type="button" className="btn" onClick={() => act({ type: 'pollReset', id })}>
                Start the votes again
              </button>
            </div>
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
