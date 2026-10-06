import type { Trivia } from '../engine/types/Trivia';
import { ANSWER_LOOK, counts, ranked, taking } from '../engine/trivia';
import { useNow } from '../engine/useNow';
import { useStage } from '../engine/CountdownContext';
import { joinShown, takesTurns } from '../engine/join';
import './TriviaView.css';
import { QrImage } from './QrImage';

/** A trivia game on screen: join, the question, the answer, the leaderboard. Mirrored in compositor.ts trivia(). */
export function TriviaView({ t, thumb = false }: { t: Trivia; thumb?: boolean }) {
  const now = useNow(t.phase === 'asking' && !thumb, 1000);
  const wifi = useStage()?.event.wifi;
  const q = t.questions[t.current];
  if (t.phase === 'join' || !q) {
    const j = joinShown(t.joinUrl, t.joinQr, 'Scan to play', wifi, takesTurns(t.joinUrl, wifi) ? now : 0);
    return (
      <div className="trv trv--join" data-kind="trivia">
        <h2 className="trv__title">{t.title}</h2>
        {t.showJoin && t.joinQr && !thumb ? (
          <div className="trv__join">
            <QrImage className="trv__qr" svg={j.qr} />
            <b>{j.label}</b>
            <small>{j.sub}</small>
          </div>
        ) : (
          <p className="trv__soon">Get your phones ready!</p>
        )}
        <p className="trv__players">
          {t.players.length} {t.players.length === 1 ? 'player' : 'players'}
        </p>
      </div>
    );
  }
  if (t.phase === 'leaderboard') {
    const top = ranked(t).slice(0, 8);
    const best = Math.max(1, top[0]?.score ?? 1);
    return (
      <div className="trv trv--board" data-kind="trivia">
        <h2 className="trv__title">Leaderboard</h2>
        <ol className="trv__board">
          {top.map((p, i) => (
            <li key={p.key}>
              <span className="trv__place">{i + 1}</span>
              <span className="trv__name" dir="auto">
                {p.name}
              </span>
              <span className="trv__barwrap">
                <i style={{ width: `${(p.score / best) * 100}%` }} />
              </span>
              <b>{p.score.toLocaleString('en-US')}</b>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  const reveal = t.phase === 'reveal';
  const left = Math.max(0, Math.ceil((t.askedAt + q.seconds * 1000 - now) / 1000));
  const open = taking(t, now);
  const n = counts(t);
  return (
    <div className="trv trv--ask" data-kind="trivia">
      <p className="trv__count">
        Question {t.current + 1} of {t.questions.length}
      </p>
      <h2 className="trv__q" dir="auto">
        {q.text}
      </h2>
      <div className="trv__timer">{reveal ? '' : open ? left : "Time's up!"}</div>
      <p className="trv__answered">{t.answers.length} answered</p>
      <div className={`trv__opts trv__opts--${q.options.length}`}>
        {q.options.map((o, i) => (
          <div key={i} className={`trv__opt${reveal ? (i === q.correct ? ' is-right' : ' is-wrong') : ''}`} style={{ background: ANSWER_LOOK[i]!.color }}>
            <span className="trv__shape">{ANSWER_LOOK[i]!.shape}</span>
            <span className="trv__text" dir="auto">
              {o}
            </span>
            {reveal && <b className="trv__n">{n[i]}</b>}
          </div>
        ))}
      </div>
    </div>
  );
}
