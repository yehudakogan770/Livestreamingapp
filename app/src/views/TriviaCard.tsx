import { CircleHelp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import type { TriviaQuestion } from '../engine/types/TriviaQuestion';
import { TriviaView } from '../components/TriviaView';
import { ANSWER_LOOK, ranked } from '../engine/trivia';
import { JoinSetup, useAudienceLink } from './JoinSetup';
import type { Act } from './act';
import './LyricsCard.css';
import './AudienceCards.css';
import './TriviaCard.css';

const blank = (): TriviaQuestion => ({ text: '', options: ['', '', '', ''], correct: 0, seconds: 20 });

/** Some questions to start with (they can be changed or removed). */
const SAMPLES: TriviaQuestion[] = [
  { text: 'How many continents are there?', options: ['5', '6', '7', '8'], correct: 2, seconds: 15 },
  { text: 'Which planet is closest to the sun?', options: ['Venus', 'Mercury', 'Mars', 'Earth'], correct: 1, seconds: 15 },
  { text: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], correct: 1, seconds: 10 },
  { text: 'What is the largest ocean?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3, seconds: 15 },
];

/** Run a trivia game: questions, answers from phones, the leaderboard. */
export function TriviaCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const t = source.kind.type === 'trivia' ? source.kind : null;
  const id = source.id;
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<TriviaQuestion>(blank);
  const [title, setTitle] = useState(t?.title ?? '');
  const { remote } = useAudienceLink(client, t, (joinUrl, joinQr) => t && act({ type: 'updateTrivia', id, trivia: { ...t, joinUrl, joinQr } }));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!t) return null;
  const save = (questions: TriviaQuestion[]) => act({ type: 'updateTrivia', id, trivia: { ...t, title, questions } });
  const saveDraft = () => {
    const options = draft.options.map((o) => o.trim());
    const used = options.map((o, i) => [o, i] as const).filter(([o]) => o);
    if (!draft.text.trim() || used.length < 2) return;
    const q = {
      ...draft,
      options: used.map(([o]) => o),
      correct: Math.max(
        0,
        used.findIndex(([, i]) => i === draft.correct),
      ),
    };
    const list = [...t.questions];
    if (editing === null) list.push(q);
    else list[editing] = q;
    save(list);
    setEditing(null);
    setDraft(blank());
  };
  const edit = (i: number) => {
    const q = t.questions[i]!;
    setEditing(i);
    setDraft({ ...q, options: [...q.options, '', '', ''].slice(0, 4) });
  };
  const asking = t.phase === 'asking';
  const next = t.phase === 'join' ? 0 : t.current + 1;
  const players = ranked(t);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Trivia" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>
            <CircleHelp className="modal__icon" aria-hidden="true" />
            Trivia · {source.name}
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run">
            <div className="lyc__stage">
              <TriviaView t={t} />
            </div>
            <div className="lyc__bar">
              {asking ? (
                <button type="button" className="btn btn--primary btn--big" onClick={() => act({ type: 'triviaReveal', id })}>
                  Show the answer
                </button>
              ) : next < t.questions.length ? (
                <button type="button" className="btn btn--primary btn--big" onClick={() => act({ type: 'triviaAsk', id, index: next })}>
                  ▶ Ask question {next + 1}
                </button>
              ) : (
                <span className="field__note">{t.questions.length ? 'That was the last question.' : 'Add questions on the right.'}</span>
              )}
              <button
                type="button"
                className={`btn${t.phase === 'leaderboard' ? ' is-on' : ''}`}
                disabled={!t.players.length}
                onClick={() => act({ type: 'triviaBoard', id, value: true })}
              >
                Leaderboard
              </button>
              <button type="button" className={`btn${t.phase === 'join' ? ' is-on' : ''}`} onClick={() => act({ type: 'triviaBoard', id, value: false })}>
                Join screen
              </button>
            </div>
            <JoinSetup remote={remote} what="play" client={client} act={act} />
            <span className="field__label">Players ({players.length})</span>
            <ol className="aud-card__list">
              {players.length === 0 && <li className="aud-card__none">Players appear when they answer their first question.</li>}
              {players.map((p, i) => (
                <li key={p.key}>
                  <span dir="auto">
                    <b>{i + 1}.</b> {p.name}
                  </span>
                  <b>{p.score.toLocaleString('en-US')}</b>
                </li>
              ))}
            </ol>
            {players.length > 0 && (
              <div className="lyc__bar">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => confirm('Start the scores from 0?') && act({ type: 'triviaReset', id, players: false })}
                >
                  Scores back to 0
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => confirm('Take everyone out of the game?') && act({ type: 'triviaReset', id, players: true })}
                >
                  New game (no players)
                </button>
              </div>
            )}
          </section>
          <section className="lyc__edit">
            <label className="field">
              <span className="field__label">Title</span>
              <input className="text" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => save(t.questions)} />
            </label>
            <span className="field__label">Questions</span>
            <ol className="aud-card__list trv-card__qs">
              {t.questions.length === 0 && (
                <li className="aud-card__none">
                  No questions yet.{' '}
                  <button type="button" className="btn btn--small" onClick={() => save(SAMPLES)}>
                    Start with sample questions
                  </button>
                </li>
              )}
              {t.questions.map((q, i) => (
                <li key={i} className={i === t.current && t.phase !== 'join' ? 'is-winner' : ''}>
                  <span dir="auto">
                    <b>{i + 1}.</b> {q.text}
                  </span>
                  <button type="button" className="btn btn--small" disabled={asking} onClick={() => act({ type: 'triviaAsk', id, index: i })}>
                    Ask
                  </button>
                  <button type="button" className="btn btn--small" disabled={asking} onClick={() => edit(i)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="icon"
                    disabled={asking}
                    aria-label={`Remove question ${i + 1}`}
                    onClick={() => save(t.questions.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
            <fieldset className="auc-card__form">
              <legend>{editing === null ? 'Add a question' : `Change question ${editing + 1}`}</legend>
              <input
                className="text"
                dir="auto"
                placeholder="The question"
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                aria-label="Question"
              />
              {draft.options.map((o, i) => (
                <div key={i} className="trv-card__opt">
                  <span className="trv-card__shape" style={{ background: ANSWER_LOOK[i]!.color }}>
                    {ANSWER_LOOK[i]!.shape}
                  </span>
                  <input
                    className="text"
                    dir="auto"
                    placeholder={i < 2 ? `Answer ${i + 1}` : `Answer ${i + 1} (if any)`}
                    value={o}
                    onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? e.target.value : x)) })}
                    aria-label={`Answer ${i + 1}`}
                  />
                  <label className="check">
                    <input type="radio" name="trv-right" checked={draft.correct === i} onChange={() => setDraft({ ...draft, correct: i })} /> Right
                  </label>
                </div>
              ))}
              <div className="lyc__row">
                <label className="field">
                  <span className="field__label">Seconds to answer</span>
                  <select className="text" value={draft.seconds} onChange={(e) => setDraft({ ...draft, seconds: Number(e.target.value) })}>
                    {[10, 15, 20, 30, 45, 60].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn btn--primary" onClick={saveDraft}>
                  {editing === null ? '+ Add the question' : 'Save the question'}
                </button>
                {editing !== null && (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                      setEditing(null);
                      setDraft(blank());
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </fieldset>
          </section>
        </div>
      </div>
    </div>
  );
}
