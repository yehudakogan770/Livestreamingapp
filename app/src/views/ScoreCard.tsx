import { useEffect, useState } from 'react';
import type { Source } from '../engine/types/Source';
import type { Scoreboard } from '../engine/types/Scoreboard';
import type { Side } from '../engine/types/Side';
import type { ScoreStyle } from '../engine/types/ScoreStyle';
import { clockShown, formatGameClock } from '../engine/score';
import { useNow } from '../engine/useNow';
import { ScoreboardView } from '../components/ScoreboardView';
import type { Act } from './act';
import './ScoreCard.css';

const STYLES: { id: ScoreStyle; name: string }[] = [
  { id: 'bug', name: 'Corner' },
  { id: 'bar', name: 'Bar' },
  { id: 'full', name: 'Full screen' },
];

const PERIODS = ['1st', '2nd', 'HT', 'ET', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'FT'];

/** Run a scoreboard: scores and the clock act at once; names and look apply on Save. */
export function ScoreCard({ source, act, onClose }: { source: Source; act: Act; onClose: () => void }) {
  const live = source.kind.type === 'scoreboard' ? source.kind : null;
  const [draft, setDraft] = useState<Scoreboard | null>(() => (live ? structuredClone(live) : null));
  const running = live?.clock.since !== null && live !== null;
  const now = useNow(false, running ? 100 : 1000);
  const [setTo, setSetTo] = useState('');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!live || !draft) return null;

  const id = source.id;
  const set = (p: Partial<Scoreboard>) => setDraft({ ...draft, ...p });
  const team = (side: Side, p: Partial<Scoreboard['home']>) => setDraft({ ...draft, [side]: { ...draft[side], ...p } });
  // What shows: the live scores and clock with the draft's names and look.
  const preview: Scoreboard = { ...draft, home: { ...draft.home, score: live.home.score }, away: { ...draft.away, score: live.away.score }, clock: live.clock };
  const save = () => act({ type: 'updateScoreboard', id, scoreboard: draft });
  const points = (side: Side) => (
    <div className="scc__team" style={{ borderColor: draft[side].color }}>
      <input className="text scc__tname" value={draft[side].name} onChange={(e) => team(side, { name: e.target.value })} aria-label={`${side} team name`} />
      <div className="scc__score">{live[side].score}</div>
      <div className="scc__btns">
        {[-1, 1, 2, 3].map((d) => (
          <button key={d} type="button" className={`btn${d > 0 ? ' btn--primary' : ''}`} onClick={() => act({ type: 'score', id, side, delta: d })}>
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
      </div>
      <div className="scc__row">
        <input
          className="text scc__short"
          value={draft[side].short}
          maxLength={4}
          onChange={(e) => team(side, { short: e.target.value.toUpperCase() })}
          aria-label={`${side} short name`}
        />
        <input type="color" value={draft[side].color} onChange={(e) => team(side, { color: e.target.value })} aria-label={`${side} colour`} />
      </div>
    </div>
  );
  const shown = clockShown(live.clock, now);
  const applyTime = () => {
    const m = /^(\d+)(?::(\d{1,2}))?$/.exec(setTo.trim());
    if (!m) return;
    const ms = m[2] === undefined ? Number(m[1]) * 60_000 : (Number(m[1]) * 60 + Number(m[2])) * 1000;
    act({ type: 'scoreClockSet', id, ms });
    setSetTo('');
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Scoreboard" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box scc">
        <header className="modal__head">
          <h2>Scoreboard · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="scc__body">
          <div className="scc__stage">
            <ScoreboardView sb={preview} />
          </div>
          <div className="scc__teams">
            {points('home')}
            <div className="scc__clock">
              <div className="scc__time">{formatGameClock(shown, live.clock.countDown)}</div>
              <button
                type="button"
                className={`btn btn--big${running ? ' is-on' : ' btn--primary'}`}
                onClick={() => act({ type: 'scoreClock', id, run: !running })}
              >
                {running ? '❚❚ Stop clock' : '▶ Start clock'}
              </button>
              <div className="scc__row">
                <input
                  className="text"
                  placeholder="mm:ss"
                  value={setTo}
                  onChange={(e) => setSetTo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyTime()}
                  aria-label="Set the clock"
                />
                <button type="button" className="btn" onClick={applyTime} disabled={!setTo}>
                  Set
                </button>
                <button type="button" className="btn" onClick={() => act({ type: 'scoreClockSet', id, ms: live.clock.countDown ? live.clock.lengthMs : 0 })}>
                  Reset
                </button>
              </div>
              <span className="field__label">Period</span>
              <div className="scc__periods">
                {PERIODS.map((p) => (
                  <button key={p} type="button" className="seg seg--small" aria-pressed={draft.period === p} onClick={() => set({ period: p })}>
                    {p}
                  </button>
                ))}
                <input className="text scc__short" value={draft.period} onChange={(e) => set({ period: e.target.value })} aria-label="Period" />
              </div>
            </div>
            {points('away')}
          </div>
          <div className="scc__look">
            <span className="field__label">Look</span>
            {STYLES.map((s) => (
              <button key={s.id} type="button" className="seg" aria-pressed={draft.style === s.id} onClick={() => set({ style: s.id })}>
                {s.name}
              </button>
            ))}
            <label className="check">
              <input type="checkbox" checked={draft.showClock} onChange={(e) => set({ showClock: e.target.checked })} /> Show the clock
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.clock.countDown} onChange={(e) => set({ clock: { ...draft.clock, countDown: e.target.checked } })} /> Count
              down from
            </label>
            <input
              className="text scc__short"
              type="number"
              min={1}
              max={240}
              value={Math.round(draft.clock.lengthMs / 60_000)}
              onChange={(e) => set({ clock: { ...draft.clock, lengthMs: Math.max(1, Number(e.target.value)) * 60_000 } })}
              aria-label="Minutes"
            />
            min
            {draft.style === 'full' && (
              <input className="text" placeholder="Title (the match)" value={draft.title} onChange={(e) => set({ title: e.target.value })} aria-label="Title" />
            )}
          </div>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={() => act({ type: 'scoreReset', id })}>
            Scores to 0
          </button>
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              save();
              onClose();
            }}
          >
            Save names and look
          </button>
        </footer>
      </div>
    </div>
  );
}
