import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Expand, Pause, Play, ScrollText, Square, Timer, Volume2, VolumeX, X } from 'lucide-react';
import { actualSec, lengthsFromRun, overUnderWords, prevIndex, runs, timerText, timerTone, whereNow, type Live, type LogEntry } from './live';
import { clock12, cueLabel, formatDuration, segmentName, sortCues, validZone, zoneAbbr, zoneParts, type Plan, type PlanCue } from './model';
import { serverNow, useTick, type LiveStore } from './useLive';
import './show.css';

/** The time of day (on the server's clock) where the show is: "7:42:10 PM". */
export function showTime(ms: number, tz: string): string {
  const d = new Date(ms);
  if (tz && validZone(tz)) {
    const p = zoneParts(d, tz)!;
    return clock12(p.h * 3600 + p.mi * 60 + p.s, true);
  }
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

const shortTime = (ms: number, tz: string): string => showTime(ms, tz).replace(/:\d{2} /, ' ');

export interface ShowData {
  plan: Plan;
  cues: PlanCue[];
  live: Live | null;
  log: LogEntry[];
  offset: number;
}

/**
 * Show day: what is on now, its time left, what is next, and how far the show
 * runs over or under. With `store` (the owner and editors), it also calls the
 * show: GO, back, pause, more or less time, messages to the stage timer.
 */
export function ShowView({
  data,
  store,
  onBack,
  backLabel = 'Back to the plan',
  onTimer,
  onPrompter,
  onUseLengths,
  compact = false,
}: {
  data: ShowData;
  /** Present when this person calls the show. */
  store?: LiveStore;
  onBack?: () => void;
  backLabel?: string;
  onTimer?: () => void;
  onPrompter?: () => void;
  /** After a rehearsal: set the cues' lengths to how long they really ran. */
  onUseLengths?: (lengths: Map<string, number>) => void;
  /** Phones: one column. */
  compact?: boolean;
}) {
  const { plan, live, log, offset } = data;
  const cues = useMemo(() => sortCues(data.cues), [data.cues]);
  const running = live?.state === 'running' || live?.state === 'paused';
  useTick(250, true);
  const now = serverNow(offset);
  const runLog = useMemo(() => (live ? log.filter((e) => e.runId === live.runId) : []), [log, live]);
  const n = whereNow(live, cues, now, runLog);
  const [pick, setPick] = useState<string | null>(null);
  const caller = !!store;
  const tz = plan.timeZone;

  const cur = n.index >= 0 ? cues[n.index]! : null;
  const next = n.next >= 0 ? cues[n.next]! : null;
  const tone = timerTone(n.remaining, cur?.durationSec ?? null);

  const go = (id: string | null | undefined) => {
    if (!store || !id) return;
    void store.act('go', { cue: id });
  };
  const goNext = () => {
    if (!store) return;
    if (!running) {
      const first = pick ?? next?.id;
      if (first) void store.act('start', { cue: first });
      return;
    }
    if (next) go(next.id);
    else void store.act('end');
  };
  const goBack = () => {
    if (n.index < 0) return;
    const p = prevIndex(cues, n.index);
    if (p >= 0) go(cues[p]!.id);
  };

  // Keys for the caller: Space or → GO, ← back, P pause, [ and ] a minute less or more.
  const keys = useRef({ goNext, goBack, store, running, paused: n.paused });
  keys.current = { goNext, goBack, store, running, paused: n.paused };
  useEffect(() => {
    if (!caller) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = keys.current;
      if (!k.store || k.store.busy) return;
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        k.goNext();
      } else if (e.key === 'ArrowLeft' && k.running) {
        e.preventDefault();
        k.goBack();
      } else if ((e.key === 'p' || e.key === 'P') && k.running) {
        e.preventDefault();
        void k.store.act(k.paused ? 'resume' : 'pause');
      } else if (e.key === ']' && k.running) void k.store.act('adjust', { seconds: 60 });
      else if (e.key === '[' && k.running) void k.store.act('adjust', { seconds: -60 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [caller]);

  // The list follows the show: the cue on now stays in view.
  const nowId = cur?.id;
  useEffect(() => {
    if (nowId) document.getElementById(`show-row-${nowId}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [nowId]);

  const mode = live?.mode === 'rehearsal' ? 'Rehearsal' : 'Show';
  const state =
    !live || live.state === 'off' ? 'Not started' : live.state === 'ended' ? `${mode} over` : live.state === 'paused' ? `${mode} · paused` : `${mode} · live`;
  const lastRun = useMemo(() => runs(log)[0], [log]);

  return (
    <main className={`show no-print${compact ? ' show--compact' : ''}`}>
      <header className="show__top">
        {onBack && (
          <button type="button" className="btn btn--quiet" onClick={onBack}>
            <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="show__back">{backLabel}</span>
          </button>
        )}
        <div className="show__id">
          <b>{plan.name || 'Untitled plan'}</b>
          <span className={`show__state show__state--${live?.state ?? 'off'}${live?.mode === 'rehearsal' ? ' is-rehearsal' : ''}`}>
            {running && live?.mode === 'show' && <i className="tally" aria-hidden="true" />}
            {state}
          </span>
        </div>
        <span className="bar__spacer" />
        <dl className="show__facts">
          <div>
            <dt>Time{tz && validZone(tz) ? ` (${zoneAbbr(tz)})` : ''}</dt>
            <dd className="mono">{showTime(now, tz)}</dd>
          </div>
          {running && n.overUnder !== null && (
            <div className={n.overUnder >= 5 ? 'is-over' : n.overUnder <= -5 ? 'is-under' : ''}>
              <dt>Show</dt>
              <dd className="mono">{overUnderWords(n.overUnder)}</dd>
            </div>
          )}
          {running && n.projectedEnd !== null && (
            <div>
              <dt>Ends about</dt>
              <dd className="mono">{shortTime(n.projectedEnd, tz)}</dd>
            </div>
          )}
        </dl>
        {onTimer && (
          <button type="button" className="btn" onClick={onTimer} title="A full-screen countdown for the stage">
            <Timer size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="show__lbl">Stage timer</span>
          </button>
        )}
        {onPrompter && (
          <button type="button" className="btn" onClick={onPrompter} title="The scripts, scrolling, for a prompter">
            <ScrollText size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="show__lbl">Prompter</span>
          </button>
        )}
      </header>
      {store?.error && <p className="warn show__err">{store.error}</p>}
      {live?.source === 'lumora' && running && <p className="muted small show__src">Called from Lumora{live.updatedBy ? ` by ${live.updatedBy}` : ''}.</p>}

      <div className="show__body">
        <section className="show__main" aria-label="On now">
          {cur ? (
            <>
              <div className="show__label">
                On now · Cue {n.index + 1} of {cues.length}
                {cur.section && <span className="muted"> · {cur.section}</span>}
              </div>
              <h1 className="show__title">{cueLabel(cur)}</h1>
              <p className="show__sub">{[cur.who, segmentName(cur.segment)].filter(Boolean).join(' · ')}</p>
              <div className={`show__clock show__clock--${tone}${n.paused ? ' is-paused' : ''}`} role="timer" aria-live="off">
                {n.remaining === null ? timerText(n.elapsed) : timerText(n.remaining)}
              </div>
              <div className="show__meter" aria-hidden="true">
                <i style={{ width: `${Math.round((n.progress ?? 0) * 100)}%` }} className={`show__meter-fill show__meter-fill--${tone}`} />
              </div>
              <p className="show__elapsed mono">
                {n.remaining === null
                  ? `${formatDuration(n.elapsed)} so far · no length planned`
                  : n.remaining < 0
                    ? `${timerText(-n.remaining)} over · planned ${formatDuration(cur.durationSec)}`
                    : `${formatDuration(n.elapsed)} of ${formatDuration(cur.durationSec)}`}
                {n.paused && ' · paused'}
              </p>
              {(cur.notes || hints(cur)) && (
                <div className="show__notes">
                  {hints(cur) && <p className="muted small">{hints(cur)}</p>}
                  {cur.notes && <p className="pre">{cur.notes}</p>}
                </div>
              )}
            </>
          ) : live?.state === 'ended' ? (
            <Summary
              cues={cues}
              log={lastRun?.runId === live.runId ? lastRun.entries : runLog}
              mode={live.mode}
              onUseLengths={caller ? onUseLengths : undefined}
            />
          ) : (
            <div className="show__idle">
              <div className="show__label">{plan.startTime ? `Planned start ${clock12Stored(plan.startTime)}` : 'Not started'}</div>
              <h1 className="show__title">{next ? `First: ${cueLabel(next)}` : 'No cues yet'}</h1>
              <p className="muted">
                {caller
                  ? 'Start the show (or a rehearsal) and press GO for each cue. Everyone on the plan, and the crew with the public link, follow along.'
                  : 'When the show starts, what is on now and next shows here, with the time left.'}
              </p>
            </div>
          )}

          {(next || cur) && (
            <div className="show__next">
              <span className="show__label">Next</span>
              {next ? (
                <>
                  <b>{cueLabel(next)}</b>
                  <span className="muted">{[next.who, next.durationSec !== null ? formatDuration(next.durationSec) : ''].filter(Boolean).join(' · ')}</span>
                </>
              ) : (
                <span className="muted">End of the show</span>
              )}
            </div>
          )}

          {live?.messageOn && (
            <div className={`show__msg${live.messageFlash ? ' is-flash' : ''}`} role="status">
              <span className="show__label">On the stage timer</span>
              {live.message}
            </div>
          )}

          {store && (
            <Controls
              store={store}
              running={running}
              paused={n.paused}
              ended={live?.state === 'ended'}
              hasNext={!!next}
              canBack={n.index >= 0 && prevIndex(cues, n.index) >= 0}
              startFrom={pick ? (cues.find((c) => c.id === pick) ?? null) : next}
              onNext={goNext}
              onBack={goBack}
              onRehearse={() => {
                const first = pick ?? next?.id ?? cues.find((c) => !c.skip)?.id;
                if (first) void store.act('rehearse', { cue: first });
              }}
              live={live}
            />
          )}
        </section>

        <aside className="show__list" aria-label="Run of show">
          <ol>
            {cues.map((c, i) => {
              const entry = [...runLog].reverse().find((e) => e.cueId === c.id);
              const done = entry && actualSec(entry);
              const diff = done != null && c.durationSec !== null ? done - c.durationSec : null;
              const isNow = i === n.index;
              return (
                <li
                  key={c.id}
                  id={`show-row-${c.id}`}
                  className={`show__row${isNow ? ' is-now' : ''}${c.skip ? ' is-skip' : ''}${done != null ? ' is-done' : ''}${pick === c.id && !running ? ' is-pick' : ''}`}
                >
                  <span className="show__n mono">{isNow ? <i className="tally" aria-hidden="true" /> : i + 1}</span>
                  <span className="show__row-id">
                    <b>{cueLabel(c)}</b>
                    <span className="muted small">{[c.who, c.skip ? 'floated' : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="show__len mono">
                    {done != null ? formatDuration(done) : formatDuration(c.durationSec)}
                    {diff !== null && Math.abs(diff) >= 5 && (
                      <span className={`show__diff ${diff > 0 ? 'is-over' : 'is-under'}`}>
                        {diff > 0 ? `+${formatDuration(diff)}` : `−${formatDuration(-diff)}`}
                      </span>
                    )}
                  </span>
                  {store && !c.skip && !isNow && (
                    <button
                      type="button"
                      className="btn btn--quiet show__go"
                      disabled={store.busy}
                      onClick={() => (running ? go(c.id) : setPick(pick === c.id ? null : c.id))}
                      title={running ? 'Go to this cue now' : 'Start from this cue'}
                    >
                      {running ? 'Go' : pick === c.id ? 'Start here ✓' : 'Start here'}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </main>
  );
}

const hints = (c: PlanCue): string =>
  [c.input && `Input: ${c.input}`, c.transition && `Transition: ${c.transition}`, c.overlay && `Title: ${c.overlay}`].filter(Boolean).join(' · ');

const clock12Stored = (t: string): string => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? clock12(Number(m[1]) * 3600 + Number(m[2]) * 60) : '';
};

/** The caller's buttons. */
function Controls({
  store,
  running,
  paused,
  ended,
  hasNext,
  canBack,
  startFrom,
  onNext,
  onBack,
  onRehearse,
  live,
}: {
  store: LiveStore;
  running: boolean;
  paused: boolean;
  ended: boolean;
  hasNext: boolean;
  canBack: boolean;
  startFrom: PlanCue | null;
  onNext: () => void;
  onBack: () => void;
  onRehearse: () => void;
  live: Live | null;
}) {
  const [msg, setMsg] = useState('');
  const [flash, setFlash] = useState(false);
  const busy = store.busy;
  return (
    <div className="show__controls">
      {!running ? (
        <div className="row row--wrap">
          <button type="button" className="btn btn--primary btn--go" disabled={busy || !startFrom} onClick={onNext}>
            <Play size={16} strokeWidth={2} aria-hidden="true" />
            {ended ? 'Start the show again' : 'Start the show'}
          </button>
          <button type="button" className="btn btn--big" disabled={busy || !startFrom} onClick={onRehearse} title="Times each cue, for the plan's lengths">
            Start a rehearsal
          </button>
          {startFrom && <span className="muted small">From cue “{cueLabel(startFrom)}”</span>}
          {ended && (
            <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void store.act('reset')}>
              Clear
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="row row--wrap show__transport">
            <button type="button" className="btn btn--big" disabled={busy || !canBack} onClick={onBack} title="The cue before (←)">
              <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
              Back
            </button>
            <button type="button" className="btn btn--primary btn--go" disabled={busy} onClick={onNext} title="Space or →">
              {hasNext ? 'GO · next cue' : 'End the show'}
              <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className="btn btn--big" disabled={busy} onClick={() => void store.act(paused ? 'resume' : 'pause')} title="P">
              {paused ? <Play size={16} strokeWidth={1.75} aria-hidden="true" /> : <Pause size={16} strokeWidth={1.75} aria-hidden="true" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <span className="show__adjust" role="group" aria-label="Time for this cue">
              <button type="button" className="btn" disabled={busy} onClick={() => void store.act('adjust', { seconds: -60 })} title="A minute less ([)">
                −1:00
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void store.act('adjust', { seconds: 60 })} title="A minute more (])">
                +1:00
              </button>
            </span>
            <span className="bar__spacer" />
            <button type="button" className="btn btn--quiet btn--danger" disabled={busy} onClick={() => confirm('End the show now?') && void store.act('end')}>
              <Square size={14} strokeWidth={1.75} aria-hidden="true" />
              End
            </button>
          </div>
          <form
            className="row show__msgform"
            onSubmit={(e) => {
              e.preventDefault();
              if (msg.trim()) void store.act('message', { message: msg, flash }).then(() => setMsg(''));
            }}
          >
            <input
              className="input grow"
              value={msg}
              maxLength={200}
              placeholder="Message to the stage timer, e.g. Wrap up"
              onChange={(e) => setMsg(e.target.value)}
              aria-label="Message to the stage timer"
              list="show-quick-msgs"
            />
            <datalist id="show-quick-msgs">
              {['Wrap up', 'One minute', 'Speed up', 'Slow down', 'Louder, please', 'Take questions', 'Stretch'].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <label className="row small nowrap">
              <input type="checkbox" checked={flash} onChange={(e) => setFlash(e.target.checked)} />
              Flash
            </label>
            <button type="submit" className="btn" disabled={busy || !msg.trim()}>
              Show
            </button>
            {live?.messageOn && (
              <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void store.act('clear')}>
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
                Take off
              </button>
            )}
          </form>
          <p className="muted small show__keys">Keys: Space or → GO · ← back · P pause · [ ] a minute less or more</p>
        </>
      )}
    </div>
  );
}

/** After a run: how long each cue really took, against the plan. */
function Summary({
  cues,
  log,
  mode,
  onUseLengths,
}: {
  cues: PlanCue[];
  log: LogEntry[];
  mode: 'show' | 'rehearsal';
  onUseLengths?: (lengths: Map<string, number>) => void;
}) {
  const [used, setUsed] = useState(false);
  const done = log.filter((e) => actualSec(e) !== null);
  const planned = done.reduce((a, e) => a + (e.plannedSec ?? 0), 0);
  const actual = done.reduce((a, e) => a + (actualSec(e) ?? 0), 0);
  const lengths = lengthsFromRun(log);
  const changes = [...lengths.entries()].filter(([id, s]) => cues.find((c) => c.id === id)?.durationSec !== s);
  return (
    <div className="show__summary">
      <div className="show__label">{mode === 'rehearsal' ? 'Rehearsal over' : 'Show over'}</div>
      <h1 className="show__title">
        {formatDuration(actual) || '0:00'} <span className="muted">of {formatDuration(planned) || '0:00'} planned</span>
      </h1>
      <p className={`show__sub ${actual - planned >= 5 ? 'is-over' : ''}`}>
        {done.length} cue{done.length === 1 ? '' : 's'} timed · {overUnderWords(actual - planned)}
      </p>
      {onUseLengths && changes.length > 0 && (
        <div className="row row--wrap">
          <button
            type="button"
            className="btn"
            disabled={used}
            onClick={() => {
              onUseLengths(new Map(changes));
              setUsed(true);
            }}
          >
            {used ? 'Lengths updated' : `Use these times as the lengths (${changes.length} cue${changes.length === 1 ? '' : 's'})`}
          </button>
          <span className="muted small">Rounded to 5 seconds.</span>
        </div>
      )}
    </div>
  );
}

/**
 * The stage timer: full screen, big. The cue's time left (yellow near the
 * end, red counting up when over), what is next, and messages from the caller.
 */
export function StageTimer({ data, onClose }: { data: ShowData; onClose?: () => void }) {
  const { plan, live, log, offset } = data;
  const cues = useMemo(() => sortCues(data.cues), [data.cues]);
  useTick(200, true);
  const now = serverNow(offset);
  const runLog = live ? log.filter((e) => e.runId === live.runId) : [];
  const n = whereNow(live, cues, now, runLog);
  const cur = n.index >= 0 ? cues[n.index]! : null;
  const next = n.next >= 0 ? cues[n.next]! : null;
  const tone = timerTone(n.remaining, cur?.durationSec ?? null);
  const [chrome, setChrome] = useState(true);
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem('lumora.planner.timer.sound') === '1';
    } catch {
      return false;
    }
  });
  // A soft chime at "wrap up", and two when the time is up (if sound is on).
  const lastTone = useRef(tone);
  useEffect(() => {
    const was = lastTone.current;
    lastTone.current = tone;
    if (!sound || was === tone || !cur) return;
    if (tone === 'wrap' && was === 'ok') chime(1);
    else if (tone === 'over') chime(2);
  }, [tone, sound, cur]);
  useEffect(() => {
    if (!chrome) return;
    const t = setTimeout(() => setChrome(false), 3000);
    return () => clearTimeout(t);
  }, [chrome]);
  const full = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.().catch(() => {});
  };
  return (
    <div className={`stage stage--${tone}${live?.messageFlash && live.messageOn ? ' is-flash' : ''}`} onPointerMove={() => setChrome(true)}>
      <div className={`stage__chrome${chrome ? ' is-on' : ''}`}>
        {onClose && (
          <button type="button" className="stage__btn" onClick={onClose}>
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            Back
          </button>
        )}
        <span className="bar__spacer" />
        <button
          type="button"
          className={`stage__btn${sound ? ' is-on' : ''}`}
          aria-pressed={sound}
          onClick={() => {
            const next = !sound;
            setSound(next);
            if (next) chime(1);
            try {
              localStorage.setItem('lumora.planner.timer.sound', next ? '1' : '0');
            } catch {
              // Not remembered: fine.
            }
          }}
        >
          {sound ? <Volume2 size={16} strokeWidth={1.75} aria-hidden="true" /> : <VolumeX size={16} strokeWidth={1.75} aria-hidden="true" />}
          Chime
        </button>
        <button type="button" className="stage__btn" onClick={full}>
          <Expand size={16} strokeWidth={1.75} aria-hidden="true" />
          Full screen
        </button>
      </div>
      <div className="stage__top">
        <span>{cur ? cueLabel(cur) : live?.state === 'ended' ? 'Thank you' : plan.name || 'Lumora Planner'}</span>
        <span className="mono">{showTime(now, plan.timeZone).replace(/:\d{2} /, ' ')}</span>
      </div>
      <div className="stage__time mono" role="timer">
        {cur ? (n.remaining === null ? timerText(n.elapsed) : timerText(n.remaining)) : '--:--'}
      </div>
      {cur && n.progress !== null && (
        <div className="stage__bar" aria-hidden="true">
          <i style={{ width: `${Math.round(n.progress * 100)}%` }} />
        </div>
      )}
      {live?.messageOn ? (
        <div className="stage__msg">{live.message}</div>
      ) : (
        <div className="stage__next">{next ? <>Next: {cueLabel(next)}</> : cur ? 'Last cue' : ''}</div>
      )}
      {n.paused && <div className="stage__paused">Paused</div>}
    </div>
  );
}

let audio: AudioContext | null = null;
/** A short, soft chime (`n` of them), for the stage timer. */
function chime(n: number): void {
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime;
    for (let i = 0; i < n; i++) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.3);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.35);
      o.stop(t0 + i * 0.35 + 0.32);
    }
  } catch {
    // No sound here: the colors still say it.
  }
}

/** A small "Now / Next" strip for crew phones and the plan's footer. */
export function NowNextStrip({ data, children }: { data: ShowData; children?: ReactNode }) {
  const { live, log, offset } = data;
  const cues = useMemo(() => sortCues(data.cues), [data.cues]);
  const on = live?.state === 'running' || live?.state === 'paused';
  useTick(500, on);
  if (!on) return null;
  const n = whereNow(
    live,
    cues,
    serverNow(offset),
    log.filter((e) => e.runId === live.runId),
  );
  const cur = n.index >= 0 ? cues[n.index]! : null;
  const next = n.next >= 0 ? cues[n.next]! : null;
  if (!cur) return null;
  return (
    <div className="nownext" role="status">
      <span className="nownext__now">
        <i className="tally" aria-hidden="true" /> <b>{cueLabel(cur)}</b>
        {n.remaining !== null && (
          <span className={`mono nownext__t${n.remaining < 0 ? ' is-over' : ''}`}>
            {n.remaining < 0 ? `+${timerText(-n.remaining)}` : timerText(n.remaining)}
          </span>
        )}
      </span>
      {next && <span className="nownext__next muted">Next: {cueLabel(next)}</span>}
      {children}
    </div>
  );
}
