import type { Block } from './blocks';
import { Mark } from './Mark';
import { clock12, formatDuration, longDate, segmentName, showClock, type Plan, type PlanCue, type Schedule } from './model';
import { PrintSchedule } from './Schedule';

/** The plan on paper (or as a PDF): only shown when printing. */
export function PrintSheet({ plan, cues, sched, blocks = [] }: { plan: Plan; cues: PlanCue[]; sched: Schedule; blocks?: Block[] }) {
  const printed = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div className="print-only print">
      <header className="print__head">
        <div className="print__id">
          <Mark size={28} />
          <div>
            <h1>{plan.name || 'Untitled plan'}</h1>
            <p>{[longDate(plan.eventDate), plan.venue].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <dl>
          {plan.startTime && (
            <>
              <dt>Starts</dt>
              <dd>{showClock(plan.startTime)}</dd>
            </>
          )}
          {plan.startTime && sched.endSec !== null && (
            <>
              <dt>Ends</dt>
              <dd>{clock12(sched.endSec)}</dd>
            </>
          )}
          <dt>Total</dt>
          <dd>{formatDuration(sched.totalSec) || '0:00'}</dd>
          <dt>Cues</dt>
          <dd>{cues.length}</dd>
        </dl>
      </header>
      {plan.notes && <p className="print__notes">{plan.notes}</p>}
      <table className="print__cues">
        <thead>
          <tr>
            <th>#</th>
            <th>Start</th>
            <th>Length</th>
            <th>Type</th>
            <th>Cue</th>
            <th>Who</th>
            <th>Lumora</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {cues.map((c, i) => {
            const t = sched.rows[i]!;
            const section = c.section && c.section !== cues[i - 1]?.section ? c.section : null;
            return [
              section ? (
                <tr key={`s-${c.id}`} className="print__section">
                  <td colSpan={8}>{section}</td>
                </tr>
              ) : null,
              <tr key={c.id}>
                <td>{i + 1}</td>
                <td className="nowrap">
                  {t.start !== null ? clock12(t.start) : ''}
                  {t.fixed && ' (fixed)'}
                </td>
                <td>{formatDuration(c.durationSec)}</td>
                <td>{segmentName(c.segment)}</td>
                <td>{c.title.trim() ? <b>{c.title}</b> : <i className="print__untitled">Untitled cue</i>}</td>
                <td>{c.who}</td>
                <td>
                  {[c.input && `Input: ${c.input}`, c.transition && `Transition: ${c.transition}`, c.overlay && `Title: ${c.overlay}`]
                    .filter(Boolean)
                    .join('; ')}
                </td>
                <td className="pre">{c.notes}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <PrintSchedule blocks={blocks} />
      <footer className="print__foot">Lumora Planner · printed {printed}</footer>
    </div>
  );
}
