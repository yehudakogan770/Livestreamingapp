import { useEffect, useState } from 'react';
import type { Cue } from '../engine/types/Cue';
import type { CueTrigger } from '../engine/types/CueTrigger';
import type { Show } from '../engine/types/Show';
import { clockSeconds, nextCueAt, nextCueIndex } from '../engine/cues';
import { clock } from '../engine/timing';
import { useNow } from '../engine/useNow';
import { StepsEditor, describeStep } from './PresetEditor';
import type { Act } from './act';
import './RunOfShow.css';
import './TextEditor.css';
import './PesukimCard.css';

/** This computer's time zone, as the engine wants it (minutes east of UTC). */
export const utcOffset = () => -new Date().getTimezoneOffset();

function triggerText(t: CueTrigger): string {
  return t.type === 'clock' ? t.time : t.type === 'afterPrevious' ? 'after previous' : 'by hand';
}

function lengthText(ms: number | null): string {
  return ms === null ? '—' : clock(ms / 1000);
}

/** "5:00" / "1:02:30" / "90" (seconds) as ms, or null. */
function parseLength(text: string): number | null {
  const parts = text.trim().split(':').map(Number);
  if (!text.trim() || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const secs = parts.reduce((a, n) => a * 60 + n, 0);
  return secs > 0 ? secs * 1000 : null;
}

/** When the next cue runs, in words: "in 0:28", "when you press NEXT CUE", or nothing. */
export function nextCueText(show: Show, now: number): string {
  const r = show.run;
  const i = nextCueIndex(r);
  if (i === null) return 'that was the last cue';
  const at = nextCueAt(r, now);
  const name = r.cues[i]!.name;
  if (!r.running) return `next: ${name}`;
  if (r.paused) return `next: ${name} · held`;
  if (at === null) return `next: ${name} · press NEXT CUE`;
  return `next: ${name} in ${clock(Math.max(0, at - now) / 1000)}`;
}

/** The strip on the bottom bar: the cue running, the next one, and NEXT CUE. */
export function CueBar({ show, act, onOpen }: { show: Show; act: Act; onOpen: () => void }) {
  const now = useNow(false, 500);
  const r = show.run;
  if (r.cues.length === 0) return null;
  const cur = r.current !== null ? r.cues[r.current] : null;
  return (
    <span className="cuebar">
      <button type="button" className="cuebar__info" onClick={onOpen} title="Run of show">
        <b>{cur ? `${r.current! + 1}. ${cur.name}` : r.running ? 'Show started' : 'Run of show'}</b>
        <em>{nextCueText(show, now)}</em>
      </button>
      <button
        type="button"
        className="btn btn--primary cuebar__next"
        onClick={() => act({ type: 'nextCue' })}
        disabled={nextCueIndex(r) === null}
        title="Run the next cue now (N)"
      >
        NEXT CUE
      </button>
    </span>
  );
}

/** The run of show: start it, hold it, run cues, and set them up. */
export function RunOfShowDialog({ show, act, onClose }: { show: Show; act: Act; onClose: () => void }) {
  const now = useNow(false, 250);
  const r = show.run;
  const [cues, setCues] = useState<Cue[]>(() => structuredClone(r.cues));
  const [sel, setSel] = useState(r.current ?? 0);
  const [lengthDraft, setLengthDraft] = useState<string | null>(null);
  const dirty = JSON.stringify(cues) !== JSON.stringify(r.cues);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const cue = cues[sel];
  const setCue = (p: Partial<Cue>) => setCues((cs) => cs.map((c, i) => (i === sel ? { ...c, ...p } : c)));
  const add = () => {
    const id = `cue-${Date.now().toString(36)}`;
    const section = cue?.section ?? '';
    setCues((cs) => [...cs.slice(0, sel + 1), { id, section, name: 'New cue', trigger: { type: 'manual' }, lengthMs: null, steps: [] }, ...cs.slice(sel + 1)]);
    setSel(cues.length ? sel + 1 : 0);
  };
  const move = (d: number) => {
    const j = sel + d;
    if (j < 0 || j >= cues.length) return;
    const next = [...cues];
    [next[sel], next[j]] = [next[j]!, next[sel]!];
    setCues(next);
    setSel(j);
  };
  const save = () => act({ type: 'setCues', cues });
  const localTime = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Run of show" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box ros">
        <header className="modal__head">
          <h2>Run of show</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="ros__run">
          <span className="ros__clock">{localTime}</span>
          {r.running ? (
            <>
              <button type="button" className="btn" onClick={() => act({ type: 'pauseShow', value: !r.paused })}>
                {r.paused ? '▶ Carry on' : '❚❚ Hold'}
              </button>
              <button type="button" className="btn" onClick={() => act({ type: 'stopShow' })}>
                Stop
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={dirty || r.cues.length === 0}
              onClick={() => act({ type: 'startShow', utcOffsetMin: utcOffset() })}
              title={dirty ? 'Save the cues first' : undefined}
            >
              ▶ Start the show
            </button>
          )}
          <button type="button" className="btn btn--primary" disabled={dirty || nextCueIndex(r) === null} onClick={() => act({ type: 'nextCue' })}>
            NEXT CUE <kbd>N</kbd>
          </button>
          <span className="ros__status">
            {r.running ? (r.paused ? 'Held — nothing runs by itself' : 'Running') : 'Not started'} · {nextCueText(show, now)}
          </span>
        </div>
        <div className="ros__body">
          <section className="ros__list" aria-label="Cues">
            <div className="ros__row ros__row--head">
              <span>#</span>
              <span>Starts</span>
              <span>Length</span>
              <span>Cue</span>
              <span />
            </div>
            {cues.map((c, i) => {
              const saved = r.cues[i]?.id === c.id;
              const state =
                saved && r.current === i ? 'live' : saved && r.current !== null && i < r.current ? 'done' : saved && nextCueIndex(r) === i ? 'next' : '';
              const section = c.section && c.section !== cues[i - 1]?.section ? c.section : null;
              return (
                <div key={c.id}>
                  {section && <div className="ros__section">{section}</div>}
                  <div className={`ros__row${i === sel ? ' is-sel' : ''} ros__row--${state || 'wait'}`} onClick={() => setSel(i)}>
                    <span>{i + 1}</span>
                    <span>{triggerText(c.trigger)}</span>
                    <span>{lengthText(c.lengthMs)}</span>
                    <span className="ros__name">
                      <b>{c.name}</b>
                      <em>{c.steps.map((st) => describeStep(st, show)).join(' · ') || 'no steps yet'}</em>
                    </span>
                    <span>
                      {state && <i className={`ros__tag ros__tag--${state}`}>{state === 'live' ? 'NOW' : state.toUpperCase()}</i>}
                      <button
                        type="button"
                        className="btn ros__go"
                        disabled={dirty}
                        onClick={(e) => {
                          e.stopPropagation();
                          act({ type: 'goCue', index: i });
                        }}
                        title={dirty ? 'Save the cues first' : 'Run this cue now'}
                      >
                        Run
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
            <button type="button" className="btn ros__add" onClick={add}>
              + Add a cue
            </button>
          </section>

          <section className="ros__edit" aria-label="Edit cue">
            {cue ? (
              <>
                <label className="field">
                  <span className="field__label">Name</span>
                  <input className="text" value={cue.name} maxLength={80} onChange={(e) => setCue({ name: e.target.value })} aria-label="Cue name" />
                </label>
                <label className="field">
                  <span className="field__label">Section</span>
                  <input
                    className="text"
                    value={cue.section}
                    maxLength={60}
                    placeholder="e.g. Opening"
                    onChange={(e) => setCue({ section: e.target.value })}
                    aria-label="Section"
                  />
                </label>
                <span className="field__label">Starts</span>
                <div className="seg-group">
                  {(
                    [
                      ['manual', 'By hand (NEXT CUE)'],
                      ['clock', 'On the clock'],
                      ['afterPrevious', 'After the previous'],
                    ] as const
                  ).map(([t, name]) => (
                    <button
                      key={t}
                      type="button"
                      className="seg"
                      aria-pressed={cue.trigger.type === t}
                      onClick={() =>
                        setCue({ trigger: t === 'clock' ? { type: 'clock', time: cue.trigger.type === 'clock' ? cue.trigger.time : '19:30' } : { type: t } })
                      }
                    >
                      {name}
                    </button>
                  ))}
                </div>
                {cue.trigger.type === 'clock' && (
                  <label className="field">
                    <span className="field__label">At (this computer’s time)</span>
                    <input
                      className="text"
                      type="time"
                      step={1}
                      value={cue.trigger.time.length === 5 ? `${cue.trigger.time}:00` : cue.trigger.time}
                      onChange={(e) =>
                        clockSeconds(e.target.value.slice(0, 8)) !== null && setCue({ trigger: { type: 'clock', time: e.target.value.slice(0, 8) } })
                      }
                      aria-label="Time"
                    />
                  </label>
                )}
                {cue.trigger.type === 'afterPrevious' && sel > 0 && cues[sel - 1]!.lengthMs === null && (
                  <p className="field__note field__note--warn">Give the cue before a length, or this one will wait for NEXT CUE.</p>
                )}
                <label className="field">
                  <span className="field__label">Length (m:ss, optional)</span>
                  <input
                    className="text"
                    value={lengthDraft ?? (cue.lengthMs === null ? '' : clock(cue.lengthMs / 1000))}
                    placeholder="e.g. 5:00"
                    onChange={(e) => setLengthDraft(e.target.value)}
                    onBlur={() => {
                      if (lengthDraft !== null) setCue({ lengthMs: parseLength(lengthDraft) });
                      setLengthDraft(null);
                    }}
                    aria-label="Length"
                  />
                </label>
                <span className="field__label">What it does, in order</span>
                <StepsEditor show={show} screen="live" steps={cue.steps} onChange={(steps) => setCue({ steps })} />
                <div className="txed__row ros__cuebtns">
                  <button type="button" className="btn" onClick={() => move(-1)} disabled={sel === 0}>
                    ▲ Earlier
                  </button>
                  <button type="button" className="btn" onClick={() => move(1)} disabled={sel === cues.length - 1}>
                    ▼ Later
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setCues((cs) => [
                        ...cs.slice(0, sel + 1),
                        { ...structuredClone(cue), id: `cue-${Date.now().toString(36)}`, name: `${cue.name} (copy)` },
                        ...cs.slice(sel + 1),
                      ]);
                      setSel(sel + 1);
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setCues((cs) => cs.filter((_, i) => i !== sel));
                      setSel(Math.max(0, sel - 1));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </>
            ) : (
              <p className="field__note">
                Add the first cue: each one runs steps — an input on air, a lower third, a message on the monitor… — by hand, on the clock, or after the
                previous one.
              </p>
            )}
          </section>
        </div>
        <footer className="modal__foot">
          {dirty && <span className="field__note field__note--warn">Changes to the cues are not saved yet.</span>}
          <span className="remote__spacer" />
          <button type="button" className="btn" disabled={!dirty} onClick={() => setCues(structuredClone(r.cues))}>
            Undo changes
          </button>
          <button type="button" className="btn btn--primary" disabled={!dirty} onClick={save}>
            Save cues
          </button>
        </footer>
      </div>
    </div>
  );
}
