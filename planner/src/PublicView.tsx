import { useEffect, useMemo, useRef, useState } from 'react';
import * as pro from './apiPro';
import { blockTime, byDay } from './blocks';
import { callGroups } from './items';
import { Brand, Mark } from './Mark';
import { clock12, cueLabel, formatDuration, longDate, schedule, segmentName, showClock, sortCues, validZone, zoneAbbr } from './model';
import { clockOffset } from './live';
import { Prompter } from './Prompter';
import { NowNextStrip, ShowView, StageTimer } from './ShowView';
import { db } from './session';
import './show.css';

export type PublicScreen = '' | 'now' | 'timer' | 'prompter';

/**
 * A plan's public page (its read-only link): no account needed. The agenda
 * for guests; for the crew, what is on now and next, the run of show with
 * notes, call times, the stage timer and the prompter. It checks for changes
 * every few seconds while the show runs.
 */
export function PublicView({ token, screen, go }: { token: string; screen: PublicScreen; go: (s: PublicScreen) => void }) {
  const [data, setData] = useState<pro.PublicPlan | null | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const running = data?.live?.state === 'running' || data?.live?.state === 'paused';
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let on = true;
    const load = () => {
      const sent = Date.now();
      pro
        .loadPublic(db(), token)
        .then((d) => {
          if (!on) return;
          setData(d);
          setError('');
          if (d) setOffset(clockOffset(d.serverNow, sent, Date.now()));
          const live = d?.live?.state === 'running' || d?.live?.state === 'paused';
          timer.current = setTimeout(load, document.hidden ? 30_000 : live ? 3000 : 20_000);
        })
        .catch((e: unknown) => {
          if (!on) return;
          setError(e instanceof Error ? e.message : String(e));
          timer.current = setTimeout(load, 15_000);
        });
    };
    load();
    const wake = () => {
      if (document.hidden) return;
      if (timer.current) clearTimeout(timer.current);
      load();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      on = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [token]);

  useEffect(() => {
    if (data?.plan.name) document.title = `${data.plan.name} · Lumora Planner`;
  }, [data?.plan.name]);

  const cues = useMemo(() => sortCues(data?.cues ?? []), [data?.cues]);
  const sched = useMemo(() => schedule(cues, data?.plan.startTime ?? ''), [cues, data?.plan.startTime]);

  if (data === undefined)
    return (
      <main className="loading" aria-busy="true">
        <Mark size={40} />
        <span className="loading__name">Lumora Planner</span>
        <span className="muted small">{error || 'Opening the plan…'}</span>
      </main>
    );
  if (data === null)
    return (
      <main className="gate">
        <div className="gate__box">
          <Brand />
          <h1 className="gate__title">This link doesn’t open a plan</h1>
          <p className="muted">The owner may have turned the link off, or made a new one. Ask them for the link again.</p>
        </div>
      </main>
    );

  const crew = data.scope === 'crew';
  const showData = { plan: data.plan, cues, live: data.live, log: [], offset };
  if (screen === 'timer' && crew) return <StageTimer data={showData} onClose={() => go('')} />;
  if (screen === 'prompter' && crew) return <Prompter cues={cues} live={data.live} title={data.plan.name || 'Untitled plan'} onClose={() => go('')} />;
  if (screen === 'now') return <ShowView data={showData} onBack={() => go('')} backLabel="Run of show" compact />;

  const tz = data.plan.timeZone && validZone(data.plan.timeZone) ? ` ${zoneAbbr(data.plan.timeZone)}` : '';
  const groups = callGroups(data.crew);
  const days = byDay(data.blocks);
  return (
    <main className="public">
      <header className="public__head">
        <div className="public__brand">
          <Mark size={22} />
          <span className="muted small">Lumora Planner</span>
        </div>
        <h1>{data.plan.name || 'Untitled plan'}</h1>
        <p className="muted">
          {[longDate(data.plan.eventDate), data.plan.startTime && `${showClock(data.plan.startTime)}${tz}`, data.plan.venue].filter(Boolean).join(' · ')}
        </p>
        <div className="row row--wrap public__nav">
          <button type="button" className={`btn${running ? ' btn--onair' : ''}`} onClick={() => go('now')}>
            {running ? 'Live now: on now and next' : 'On now and next'}
          </button>
          {crew && (
            <>
              <button type="button" className="btn" onClick={() => go('timer')}>
                Stage timer
              </button>
              <button type="button" className="btn" onClick={() => go('prompter')}>
                Prompter
              </button>
            </>
          )}
        </div>
      </header>
      <NowNextStrip data={showData} />
      {crew && data.plan.notes && <p className="public__notes pre">{data.plan.notes}</p>}
      <section className="public__sec" aria-label={crew ? 'Run of show' : 'Agenda'}>
        <h2>{crew ? 'Run of show' : 'Agenda'}</h2>
        <ol className="public__list">
          {cues.map((c, i) => {
            const t = sched.rows[i]!;
            if (c.skip) return null;
            const section = c.section && c.section !== cues[i - 1]?.section ? c.section : null;
            const isNow = data.live?.cueId === c.id && running;
            return (
              <li key={c.id} className={isNow ? 'is-now' : ''}>
                {section && <div className="public__section">{section}</div>}
                <div className="public__row">
                  <span className="mono public__time">{t.start !== null ? clock12(t.start) : ''}</span>
                  <span className="public__what">
                    <b>
                      {isNow && <i className="tally" aria-hidden="true" />} {cueLabel(c)}
                    </b>
                    {crew && (
                      <span className="muted small">
                        {[c.who, segmentName(c.segment), c.durationSec !== null ? formatDuration(c.durationSec) : ''].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {crew && c.notes && <span className="small pre">{c.notes}</span>}
                  </span>
                  {!crew && c.durationSec !== null && <span className="mono muted small">{formatDuration(c.durationSec)}</span>}
                </div>
              </li>
            );
          })}
        </ol>
        {cues.length === 0 && <p className="muted">Nothing planned yet.</p>}
      </section>
      {days.length > 0 && (
        <section className="public__sec" aria-label="Schedule">
          <h2>Schedule</h2>
          {days.map((d) => (
            <div key={d.day} className="public__day">
              {days.length > 1 && <h3>{longDate(d.day) || 'No date'}</h3>}
              <ul className="public__list">
                {d.blocks.map((b) => (
                  <li key={b.id}>
                    <div className="public__row">
                      <span className="mono public__time">{blockTime(b)}</span>
                      <span className="public__what">
                        <b>{b.title || 'Untitled block'}</b>
                        <span className="muted small">{[b.location, b.who].filter(Boolean).join(' · ')}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {crew && groups.length > 0 && (
        <section className="public__sec" aria-label="Crew calls">
          <h2>Crew calls</h2>
          <ul className="public__list">
            {groups.map((g, i) => (
              <li key={i}>
                <div className="public__row">
                  <span className="mono public__time">{g.time || '—'}</span>
                  <span className="public__what">
                    {g.people.map((p) => (
                      <span key={p.id}>
                        <b>{p.title || 'Unnamed'}</b>
                        {p.role && <span className="muted"> · {p.role}</span>}
                      </span>
                    ))}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="public__foot muted small">
        <Mark size={14} /> Made with Lumora Planner · read-only
      </footer>
    </main>
  );
}
