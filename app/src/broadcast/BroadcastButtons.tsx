import { useEffect, useRef, useState } from 'react';
import type { CaptureKind } from '../engine/client';
import { clock } from '../engine/timing';
import { useBroadcast } from './BroadcastContext';
import { verdict } from './rehearsal';
import { nextAt, timeText } from './schedule';
import './broadcast.css';

/** How long something has been running, ticking every second. */
function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [since]);
  return since === null ? '' : clock((now - since) / 1000);
}

/** REC and LIVE on the bottom bar. Stopping always asks first. */
export function BroadcastButtons({ onSettings }: { onSettings: () => void }) {
  const b = useBroadcast();
  const [confirm, setConfirm] = useState<{
    kind: CaptureKind;
    stopping: boolean;
  } | null>(null);
  const rec = b?.status.recording ?? null;
  const live = b?.status.streaming ?? null;
  const recTime = useElapsed(rec?.startedAt ?? null);
  const liveTime = useElapsed(live?.startedAt ?? null);
  // Say where a finished recording went, for a while.
  const last = b?.status.lastRecording ?? null;
  const [saved, setSaved] = useState<string | null>(null);
  const seen = useRef(last);
  useEffect(() => {
    if (last === seen.current) return;
    seen.current = last;
    setSaved(last);
    if (!last) return;
    const id = setTimeout(() => setSaved(null), 12000);
    return () => clearTimeout(id);
  }, [last]);
  if (!b) return null;
  const reconnecting = !live && b.reconnecting;
  const destinations = b.settings.destinations.filter((d) => d.enabled && d.url.trim());

  const press = (kind: CaptureKind) => {
    const running = kind === 'record' ? !!rec : !!live || !!reconnecting;
    if (running) return setConfirm({ kind, stopping: true });
    if (kind === 'record') return void b.start('record').catch(() => {});
    // Going live: set up first if there is nowhere to go, otherwise confirm (a rehearsal needs nowhere).
    if (destinations.length === 0 && !b.rehearsal) return onSettings();
    setConfirm({ kind, stopping: false });
  };

  const yes = () => {
    if (!confirm) return;
    setConfirm(null);
    void (confirm.stopping ? b.stop(confirm.kind) : b.start(confirm.kind)).catch(() => {});
  };

  return (
    <>
      <button
        type="button"
        className={`btn bc-btn${rec ? ' bc-btn--rec' : ''}`}
        aria-pressed={!!rec}
        disabled={b.busy.record}
        title={rec?.path ? `Recording to ${rec.path}` : 'Record the Live Screen to a file'}
        onClick={() => press('record')}
      >
        <i className="bc-dot" />
        {rec ? `REC ${recTime}` : b.status.finishing ? 'Saving…' : 'REC'}
      </button>
      <button
        type="button"
        className={`btn bc-btn bc-btn--small${b.rehearsal ? ' bc-btn--rehearse' : ''}`}
        aria-pressed={b.rehearsal}
        disabled={!!live}
        title="Rehearsal: practice the whole event as if live, with nothing sent anywhere. A report comes at the end."
        onClick={() => b.setRehearsal(!b.rehearsal)}
      >
        Rehearsal
      </button>
      <button
        type="button"
        className={`btn bc-btn${live ? (b.rehearsal ? ' bc-btn--rehearse' : ' bc-btn--live') : ''}${reconnecting ? ' bc-btn--warn' : ''}`}
        aria-pressed={!!live}
        disabled={b.busy.stream}
        title={
          live
            ? b.rehearsal
              ? 'Rehearsing: nothing is being sent'
              : `Live on ${live.destinations.join(', ')}`
            : b.rehearsal
              ? 'Start the rehearsal'
              : 'Stream the Live Screen'
        }
        onClick={() => press('stream')}
      >
        <i className="bc-dot" />
        {live
          ? `${b.rehearsal ? 'REHEARSING' : 'LIVE'} ${liveTime}`
          : reconnecting
            ? 'Reconnecting…'
            : b.schedule
              ? `LIVE AT ${timeText(b.schedule.at)}`
              : b.rehearsal
                ? 'REHEARSE'
                : 'GO LIVE'}
      </button>
      <ReplayButtons />

      {saved && (
        <div className="bc-saved" role="status">
          Recording saved:{' '}
          {saved.startsWith('blob:') ? (
            <a href={saved} download="Lumora recording.webm">
              download it
            </a>
          ) : (
            <>
              <span className="bc-saved__path">{saved}</span>
              {b.settings.iso !== false && (
                <span className="bc-saved__edit"> To edit it with every camera, open the .lumora file next to it in Lumora Edit.</span>
              )}
            </>
          )}
          <button type="button" className="icon" aria-label="Close" onClick={() => setSaved(null)}>
            ✕
          </button>
        </div>
      )}
      {b.rehearsalReport && <RehearsalReportDialog />}
      {confirm && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm" onPointerDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal__box confirm">
            <header className="modal__head">
              <h2>
                {confirm.stopping
                  ? confirm.kind === 'record'
                    ? 'Stop recording?'
                    : b.rehearsal
                      ? 'End the rehearsal?'
                      : 'End the stream?'
                  : b.rehearsal
                    ? 'Start the rehearsal?'
                    : 'Go live?'}
              </h2>
            </header>
            <p className="confirm__text">
              {confirm.stopping
                ? confirm.kind === 'record'
                  ? 'The recording is saved and a new one can be started any time.'
                  : b.rehearsal
                    ? 'You’ll get a report of how it went.'
                    : 'Viewers will see the stream end.'
                : b.rehearsal
                  ? 'Everything runs exactly as if live, but nothing is sent anywhere. Run through the event, then end the rehearsal for a report.'
                  : `The Live Screen goes out to ${destinations.map((d) => d.name).join(', ')}.`}
            </p>
            {!confirm.stopping && confirm.kind === 'stream' && <Later onDone={() => setConfirm(null)} />}
            {!confirm.stopping && !b.rehearsal && destinations.some((d) => !d.key.trim()) && (
              <p className="confirm__text field__note--warn">
                No stream key for{' '}
                {destinations
                  .filter((d) => !d.key.trim())
                  .map((d) => d.name)
                  .join(', ')}
                . Most services need one (Settings → Recording and streaming).
              </p>
            )}
            <footer className="modal__foot">
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className={`btn ${confirm.stopping ? 'btn--danger' : 'btn--primary'}`} onClick={yes} autoFocus>
                {confirm.stopping
                  ? confirm.kind === 'record'
                    ? 'Stop recording'
                    : b.rehearsal
                      ? 'End rehearsal'
                      : 'End stream'
                  : b.rehearsal
                    ? 'Start rehearsal'
                    : 'Go live'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

/** Instant replay: keep the last minute, then replay the last few seconds (slow motion or not). */
function ReplayButtons() {
  const b = useBroadcast();
  const [slow, setSlow] = useState(true);
  const [secs, setSecs] = useState(10);
  const [menu, setMenu] = useState(false);
  const [making, setMaking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!b) return null;
  if (!b.replayOn)
    return (
      <button type="button" className="btn bc-btn" title="Keep the last minute of the Live Screen, ready to replay" onClick={() => b.setReplay(true)}>
        ⟲ REPLAY
      </button>
    );
  const make = () => {
    setMaking(true);
    setNote(null);
    b.makeReplay(secs, slow ? 0.5 : 1)
      .then(() => setNote(`Replay of the last ${secs}s is in Next — TAKE it.`))
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setMaking(false);
        setTimeout(() => setNote(null), 5000);
      });
  };
  return (
    <span className="bc-replay" role="group" aria-label="Instant replay">
      <button
        type="button"
        className="btn bc-btn bc-btn--replay"
        disabled={making}
        title={`Replay the last ${secs} seconds${slow ? ' in slow motion' : ''} (to Next)`}
        onClick={make}
      >
        ⟲ {secs}s{slow ? ' ½×' : ''}
      </button>
      <button type="button" className="btn bc-btn bc-replay__more" aria-label="Replay options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        ▾
      </button>
      {menu && (
        <div className="bc-replay__menu" role="dialog" aria-label="Replay options">
          <span className="field__label">Replay the last</span>
          <div className="bc-replay__row">
            {[5, 10, 20, 30].map((s) => (
              <button key={s} type="button" className="seg" aria-pressed={secs === s} onClick={() => setSecs(s)}>
                {s}s
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> Slow motion (half speed)
          </label>
          <span className="field__label">Highlights reel</span>
          <button
            type="button"
            className="btn"
            disabled={making}
            title={`Keep the last ${secs} seconds: every highlight goes into one video input that plays them one after another`}
            onClick={() => {
              setMaking(true);
              b.saveHighlight(secs)
                .then((n) => setNote(`Kept — ${n} ${n === 1 ? 'highlight' : 'highlights'} in “Highlights reel”.`))
                .catch((e: unknown) => setNote(e instanceof Error ? e.message : String(e)))
                .finally(() => {
                  setMaking(false);
                  setTimeout(() => setNote(null), 5000);
                });
            }}
          >
            ★ Keep as a highlight
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setMenu(false);
              b.setReplay(false);
            }}
          >
            Stop keeping replays
          </button>
        </div>
      )}
      {note && (
        <span className="bc-saved" role="status">
          {note}
        </span>
      )}
    </span>
  );
}

/** How the rehearsal went. */
function RehearsalReportDialog() {
  const b = useBroadcast();
  if (!b?.rehearsalReport) return null;
  const r = b.rehearsalReport;
  const v = verdict(r);
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Rehearsal report"
      onPointerDown={(e) => e.target === e.currentTarget && b.closeRehearsalReport()}
    >
      <div className="modal__box confirm">
        <header className="modal__head">
          <h2>{v.good ? 'The rehearsal went well' : 'How the rehearsal went'}</h2>
        </header>
        <div className="confirm__text">
          <p>
            {r.minutes} minute{r.minutes === 1 ? '' : 's'}.{' '}
            {v.good ? 'Nothing went wrong, and the computer kept up the whole time. You’re ready.' : 'Worth fixing before the event:'}
          </p>
          {!v.good && (
            <ul className="bc-report">
              {v.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <p className="field__note">Turn Rehearsal off before the real event, so GO LIVE goes live.</p>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={() => b.closeRehearsalReport()}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              b.setRehearsal(false);
              b.closeRehearsalReport();
            }}
          >
            Turn Rehearsal off
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Go live later, at a set time (the stream starts early with the countdown on screen). */
function Later({ onDone }: { onDone: () => void }) {
  const b = useBroadcast();
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    return `${String(d.getHours()).padStart(2, '0')}:${d.getMinutes() < 30 ? '30' : '00'}`;
  });
  const [early, setEarly] = useState(10);
  if (!b) return null;
  if (b.schedule)
    return (
      <div className="bc-later">
        Going live by itself at <b>{timeText(b.schedule.at)}</b>.{' '}
        <button
          type="button"
          className="linkish"
          onClick={() => {
            b.setSchedule(null);
            onDone();
          }}
        >
          Cancel that
        </button>
      </div>
    );
  const at = nextAt(time);
  return (
    <div className="bc-later">
      <span>Or go live later, by itself, at</span>
      <input type="time" className="text" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Start time" />
      <select value={early} onChange={(e) => setEarly(Number(e.target.value))} aria-label="Start streaming early">
        <option value={0}>exactly then</option>
        <option value={5}>streaming 5 min early</option>
        <option value={10}>streaming 10 min early</option>
        <option value={15}>streaming 15 min early</option>
        <option value={30}>streaming 30 min early</option>
      </select>
      <button
        type="button"
        className="btn"
        disabled={!at}
        onClick={() => {
          if (at) b.setSchedule({ at, earlyMin: early });
          onDone();
        }}
      >
        Set
      </button>
      <span className="field__note">The countdown shows until then; at the time, what is in Next goes on air.</span>
    </div>
  );
}
