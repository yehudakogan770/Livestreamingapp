import { ChartColumn, Cloud, Download, Play, Square, Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import { JoinSetup, useAudienceLink } from './JoinSetup';
import './AudienceCards.css';
import type { Poll } from '../engine/types/Poll';
import type { Source } from '../engine/types/Source';
import { PollView } from '../components/PollView';
import { averageText, countText, POLL_KIND_NAME, ratingAverage, responses } from '../engine/poll';
import { csvName, pollRows, toCsv } from '../engine/audienceExport';
import type { Act } from './act';
import './LyricsCard.css';

const ICON = { choice: ChartColumn, words: Cloud, rating: Star } as const;
const VERB = { choice: 'voting', words: 'taking words', rating: 'rating' } as const;

/** Run an audience poll, word cloud or rating: open it, watch the answers come in, show the results. */
export function PollCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const live = source.kind.type === 'poll' ? source.kind : null;
  const [draft, setDraft] = useState<Poll | null>(() => (live ? structuredClone(live) : null));
  const [saved, setSaved] = useState<string | null>(null);
  // Keep the code on screen pointing at the current address.
  const { remote } = useAudienceLink(client, live, (joinUrl, joinQr) => live && act({ type: 'updatePoll', id: source.id, poll: { ...live, joinUrl, joinQr } }));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!live || !draft) return null;

  const id = source.id;
  const kind = live.kind ?? 'choice';
  const Icon = ICON[kind];
  const options = draft.options.join('\n');
  const dirty = draft.question !== live.question || (kind === 'choice' && options !== live.options.join('\n'));
  const save = () =>
    act({
      type: 'updatePoll',
      id,
      poll: { ...live, question: draft.question, options: kind === 'choice' ? draft.options.filter((o) => o.trim()) : live.options },
    });
  const exportCsv = async () => {
    try {
      const where = await client.saveCsv(csvName(source.name), toCsv(pollRows(live)));
      if (where) setSaved(`Saved to ${where}`);
    } catch (e) {
      setSaved(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={POLL_KIND_NAME[kind]} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>
            <Icon className="modal__icon" aria-hidden="true" />
            {POLL_KIND_NAME[kind]} · {source.name}
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
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
                {live.open ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
                {live.open ? `Stop ${VERB[kind]}` : `Start ${VERB[kind]}`}
              </button>
              <label className="check">
                <input type="checkbox" checked={live.showResults} onChange={(e) => act({ type: 'pollShowResults', id, value: e.target.checked })} />{' '}
                {kind === 'words' ? 'Show the words on screen' : 'Show the results on screen'}
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
              {countText(live)} so far{kind === 'rating' ? `, averaging ${averageText(ratingAverage(live))} stars` : ''}.
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
            {kind === 'choice' && (
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
            )}
            <div className="lyc__row">
              <button type="button" className="btn btn--primary" disabled={!dirty} onClick={save}>
                Save question
              </button>
              <button type="button" className="btn" onClick={() => act({ type: 'pollReset', id })}>
                {kind === 'words' ? 'Clear the words' : kind === 'rating' ? 'Clear the ratings' : 'Start the votes again'}
              </button>
            </div>
            {kind === 'words' && <WordList poll={live} onRemove={(word) => act({ type: 'pollWordRemove', id, word })} />}
            {kind === 'rating' && <Comments poll={live} />}
          </section>
        </div>
        <footer className="modal__foot">
          {saved && (
            <span className="field__note" role="status">
              {saved}
            </span>
          )}
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={() => void exportCsv()} disabled={responses(live) === 0 && !live.comments.length}>
            <Download aria-hidden="true" />
            Export results (CSV)
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The words sent, most first; any can be taken out of the cloud. */
function WordList({ poll, onRemove }: { poll: Poll; onRemove: (word: string) => void }) {
  const words = [...poll.words].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return (
    <div className="field">
      <span className="field__label">Words sent ({words.length})</span>
      {words.length === 0 ? (
        <p className="field__note">Words appear here as phones send them. Take out anything that should not be on screen.</p>
      ) : (
        <ul className="aud-card__list" aria-label="Words sent">
          {words.map((w) => (
            <li key={w.text}>
              <span dir="auto">{w.text}</span>
              <b className="aud-card__count">{w.count}</b>
              <button
                type="button"
                className="icon"
                aria-label={`Take “${w.text}” out of the cloud`}
                title="Take out of the cloud"
                onClick={() => onRemove(w.text)}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The comments sent with ratings, newest first (only the operator sees them). */
function Comments({ poll }: { poll: Poll }) {
  const list = [...poll.comments].reverse();
  return (
    <div className="field">
      <span className="field__label">Comments ({list.length})</span>
      {list.length === 0 ? (
        <p className="field__note">Comments sent with a rating appear here. Only you see them; they are in the export.</p>
      ) : (
        <ul className="aud-card__list" aria-label="Comments">
          {list.map((c, i) => (
            <li key={`${c.at}-${i}`} className="aud-card__comment">
              <b className="aud-card__count" aria-label={`${c.stars} of 5 stars`}>
                {c.stars}/5
              </b>
              <span dir="auto">{c.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
