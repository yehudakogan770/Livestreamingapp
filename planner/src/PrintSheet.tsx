import type { Block } from './blocks';
import { Mark } from './Mark';
import { KIND_WORDS, budgetTotals, callGroups, dollars, listOf, type Item, type ItemKind } from './items';
import { clock12, cueLabel, formatDuration, longDate, parseClock, segmentName, showClock, zoneAbbr, type Plan, type PlanCue, type Schedule } from './model';
import { PrintSchedule } from './Schedule';
import { blockTime, byDay } from './blocks';
import './print.css';

/** What goes on paper: the run of show, the call sheet, the scripts, or the lists. */
export type PrintLayout = 'run' | 'callsheet' | 'scripts' | 'lists';

export const PRINT_LAYOUTS: { id: PrintLayout; name: string; what: string }[] = [
  { id: 'run', name: 'Run of show', what: 'Every cue with times, who and notes; the schedule after it.' },
  { id: 'callsheet', name: 'Call sheet', what: 'For the crew: call times, the day’s schedule, contacts and the show at a glance.' },
  { id: 'scripts', name: 'Scripts', what: 'Each cue’s script, two columns like a TV script, for talent and the prompter operator.' },
  { id: 'lists', name: 'Lists', what: 'Tasks, gear and contacts (and the budget, for the owner and editors).' },
];

function Head({ plan, sched, cues, title }: { plan: Plan; sched: Schedule; cues: PlanCue[]; title?: string }) {
  const tz = plan.timeZone ? ` ${zoneAbbr(plan.timeZone)}` : '';
  return (
    <header className="print__head">
      <div className="print__id">
        <Mark size={28} />
        <div>
          <h1>
            {plan.name || 'Untitled plan'}
            {title && <span className="print__kind"> · {title}</span>}
          </h1>
          <p>{[longDate(plan.eventDate), plan.venue].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <dl>
        {plan.startTime && (
          <>
            <dt>Starts</dt>
            <dd>
              {showClock(plan.startTime)}
              {tz}
            </dd>
          </>
        )}
        {plan.startTime && sched.endSec !== null && (
          <>
            <dt>Ends</dt>
            <dd>
              {clock12(sched.endSec)}
              {tz}
            </dd>
          </>
        )}
        <dt>Total</dt>
        <dd>{formatDuration(sched.totalSec) || '0:00'}</dd>
        <dt>Cues</dt>
        <dd>{cues.filter((c) => !c.skip).length}</dd>
      </dl>
    </header>
  );
}

const printedAt = () => new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The plan on paper (or as a PDF): only shown when printing. */
export function PrintSheet({
  plan,
  cues,
  sched,
  blocks = [],
  items = [],
  layout = 'run',
}: {
  plan: Plan;
  cues: PlanCue[];
  sched: Schedule;
  blocks?: Block[];
  items?: Item[];
  layout?: PrintLayout;
}) {
  return (
    <div className={`print-only print print--${layout}`}>
      {layout === 'run' && <RunOfShow plan={plan} cues={cues} sched={sched} blocks={blocks} />}
      {layout === 'callsheet' && <CallSheet plan={plan} cues={cues} sched={sched} blocks={blocks} items={items} />}
      {layout === 'scripts' && <Scripts plan={plan} cues={cues} sched={sched} />}
      {layout === 'lists' && <Lists plan={plan} cues={cues} sched={sched} items={items} />}
      <footer className="print__foot">Lumora Planner · printed {printedAt()}</footer>
    </div>
  );
}

function RunOfShow({ plan, cues, sched, blocks }: { plan: Plan; cues: PlanCue[]; sched: Schedule; blocks: Block[] }) {
  const cols = plan.columns;
  const width = 8 + cols.length;
  return (
    <>
      <Head plan={plan} sched={sched} cues={cues} />
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
            {cols.map((c) => (
              <th key={c.id}>{c.name}</th>
            ))}
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
                  <td colSpan={width}>{section}</td>
                </tr>
              ) : null,
              <tr key={c.id} className={`${c.skip ? 'print__skip ' : ''}${c.color ? `print__color print__color--${c.color}` : ''}`}>
                <td>{i + 1}</td>
                <td className="nowrap">
                  {t.skipped ? 'floated' : t.start !== null ? clock12(t.start) : ''}
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
                {cols.map((col) => (
                  <td key={col.id}>{c.custom[col.id] ?? ''}</td>
                ))}
                <td className="pre">{c.notes}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <PrintSchedule blocks={blocks} />
    </>
  );
}

/** The crew's page: when to be where, who to call, and the show at a glance. */
function CallSheet({ plan, cues, sched, blocks, items }: { plan: Plan; cues: PlanCue[]; sched: Schedule; blocks: Block[]; items: Item[] }) {
  const groups = callGroups(items);
  const contacts = listOf(items, 'contact');
  const firstCall = groups.find((g) => g.time)?.time;
  const days = byDay(blocks);
  return (
    <>
      <Head plan={plan} sched={sched} cues={cues} title="Call sheet" />
      <div className="print__keytimes">
        {firstCall && (
          <div>
            <span>First call</span>
            <b>{firstCall}</b>
          </div>
        )}
        {plan.startTime && (
          <div>
            <span>Show</span>
            <b>{showClock(plan.startTime)}</b>
          </div>
        )}
        {plan.startTime && sched.endSec !== null && (
          <div>
            <span>Ends</span>
            <b>{clock12(sched.endSec)}</b>
          </div>
        )}
        {plan.venue && (
          <div>
            <span>Where</span>
            <b>{plan.venue}</b>
          </div>
        )}
      </div>
      {plan.notes && <p className="print__notes">{plan.notes}</p>}
      <div className="print__cols">
        <section>
          <h2>Crew calls</h2>
          {groups.length === 0 ? (
            <p className="print__none">No crew listed yet (Crew tab).</p>
          ) : (
            <table className="print__cues print__plain">
              <thead>
                <tr>
                  <th>Call</th>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((g) =>
                  g.people.map((p, i) => (
                    <tr key={p.id}>
                      <td className="nowrap">{i === 0 ? [g.day && longDate(g.day).replace(/, \d{4}$/, ''), g.time].filter(Boolean).join(' · ') || '—' : ''}</td>
                      <td>
                        <b>{p.title || 'Unnamed'}</b>
                      </td>
                      <td>{p.role}</td>
                      <td className="nowrap">{p.phone}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </section>
        <section>
          <h2>Schedule</h2>
          {days.length === 0 ? (
            <p className="print__none">No schedule blocks yet (Schedule tab).</p>
          ) : (
            <table className="print__cues print__plain">
              <tbody>
                {days.flatMap((d) =>
                  d.blocks.map((b, i) => (
                    <tr key={b.id}>
                      <td className="nowrap">{i === 0 && days.length > 1 ? longDate(d.day).replace(/, \d{4}$/, '') : ''}</td>
                      <td className="nowrap">{blockTime(b)}</td>
                      <td>
                        <b>{b.title || 'Untitled block'}</b>
                        {b.location && <span> · {b.location}</span>}
                        {b.who && <div className="print__sub">{b.who}</div>}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
          {contacts.length > 0 && (
            <>
              <h2>Contacts</h2>
              <table className="print__cues print__plain">
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <b>{c.title}</b>
                        {c.role && <div className="print__sub">{c.role}</div>}
                      </td>
                      <td className="nowrap">{c.phone}</td>
                      <td>{c.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
      <section className="print__glance">
        <h2>The show at a glance</h2>
        <ol>
          {cues
            .map((c, i) => ({ c, t: sched.rows[i]! }))
            .filter(({ c }) => !c.skip)
            .map(({ c, t }) => (
              <li key={c.id}>
                <span className="mono">{t.start !== null ? clock12(t.start) : ''}</span> {cueLabel(c)}
                {c.who && <span className="print__sub"> · {c.who}</span>}
              </li>
            ))}
        </ol>
      </section>
    </>
  );
}

/** Two columns per cue, like a TV script: what happens on the left, what is said on the right. */
function Scripts({ plan, cues, sched }: { plan: Plan; cues: PlanCue[]; sched: Schedule }) {
  const shown = cues.map((c, i) => ({ c, i, t: sched.rows[i]! })).filter(({ c }) => !c.skip);
  return (
    <>
      <Head plan={plan} sched={sched} cues={cues} title="Scripts" />
      <div className="print__script">
        {shown.map(({ c, i, t }) => (
          <div key={c.id} className="print__scue">
            <div className="print__sleft">
              <b>
                {i + 1}. {cueLabel(c)}
              </b>
              <div className="mono">
                {t.start !== null ? clock12(t.start) : ''} {c.durationSec !== null ? `· ${formatDuration(c.durationSec)}` : ''}
              </div>
              {c.who && <div>{c.who}</div>}
              {[c.input && `Input: ${c.input}`, c.transition && `Transition: ${c.transition}`, c.overlay && `Title: ${c.overlay}`]
                .filter(Boolean)
                .map((h) => (
                  <div key={h} className="print__sub">
                    {h}
                  </div>
                ))}
              {c.notes && <div className="print__sub pre">{c.notes}</div>}
            </div>
            <div className="print__sright pre">{c.script.trim() || <i className="print__untitled">No script</i>}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function Lists({ plan, cues, sched, items }: { plan: Plan; cues: PlanCue[]; sched: Schedule; items: Item[] }) {
  const cueName = (id: string | null) => {
    const i = id ? cues.findIndex((c) => c.id === id) : -1;
    return i >= 0 ? `${i + 1}. ${cueLabel(cues[i]!)}` : '';
  };
  const kinds: ItemKind[] = ['task', 'gear', 'contact', 'budget'];
  const time = (t: string) => {
    const s = parseClock(t);
    return s === null ? '' : clock12(s);
  };
  return (
    <>
      <Head plan={plan} sched={sched} cues={cues} title="Lists" />
      {kinds.map((k) => {
        const list = listOf(items, k);
        if (!list.length) return null;
        return (
          <section key={k} className="print__sched">
            <h2>{KIND_WORDS[k].name}</h2>
            <table className="print__cues print__plain">
              <tbody>
                {list.map((it) => (
                  <tr key={it.id}>
                    {k === 'task' && <td className="nowrap">{it.done ? '☑' : '☐'}</td>}
                    <td>
                      <b>{it.title}</b>
                    </td>
                    {k === 'task' && <td>{it.person}</td>}
                    {k === 'task' && <td className="nowrap">{it.day}</td>}
                    {k === 'task' && <td>{cueName(it.cueId)}</td>}
                    {k === 'gear' && <td>{it.qty ?? ''}</td>}
                    {(k === 'gear' || k === 'contact' || k === 'budget') && <td>{it.role}</td>}
                    {(k === 'gear' || k === 'budget') && <td>{it.person}</td>}
                    {k === 'gear' && <td>{it.status}</td>}
                    {k === 'contact' && <td className="nowrap">{it.phone}</td>}
                    {k === 'contact' && <td>{it.email}</td>}
                    {k === 'budget' && <td className="nowrap">{dollars(it.amount)}</td>}
                    {k === 'budget' && <td className="nowrap">{dollars(it.actual)}</td>}
                    {k === 'contact' && it.callTime && <td>{time(it.callTime)}</td>}
                    <td className="pre">{it.notes}</td>
                  </tr>
                ))}
              </tbody>
              {k === 'budget' && (
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      <b>Total</b>
                    </td>
                    <td>
                      <b>{dollars(budgetTotals(items).estimate)}</b>
                    </td>
                    <td>
                      <b>{dollars(budgetTotals(items).actual)}</b>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </section>
        );
      })}
    </>
  );
}
