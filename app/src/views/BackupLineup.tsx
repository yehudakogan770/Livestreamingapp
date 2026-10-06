// The backup lineup in the control window: the watcher that notices an input
// on air losing its picture and switches to the next one, the notice that
// tells the operator, and the settings dialog. The rules are in
// ../engine/backup.ts; what has a picture in ../engine/inputHealth.ts; what
// it did in ../engine/backupLog.ts.

import { ChevronDown, ChevronUp, ListOrdered, Plus, RotateCcw, VideoOff, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { automaticLineup, backupOf, canStandIn, cleanBackup, Failover, lineupOf } from '../engine/backup';
import type { EngineClient } from '../engine/client';
import { inputHealth, type InputHealth } from '../engine/inputHealth';
import type { Action } from '../engine/types/Action';
import type { Backup } from '../engine/types/Backup';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { backupLog, BackupLog, clockTime, noteText, SCREEN_NAME } from '../engine/backupLog';
import { useProblemStore } from '../problems/problems';
import './BackupLineup.css';

/**
 * Watches the inputs and runs the failover. Lives in the control window
 * (one per window); `health` and `log` can be replaced in tests.
 */
export function BackupWatcher({
  show,
  client,
  health = inputHealth,
  log = backupLog,
  intervalMs = 250,
}: {
  show: Show;
  client: EngineClient;
  health?: InputHealth;
  log?: BackupLog;
  intervalMs?: number;
}) {
  const latest = useRef(show);
  latest.current = show;
  const failover = useRef<Failover | null>(null);
  failover.current ??= new Failover();
  const store = useProblemStore();
  const me = useRef(Symbol('backup')).current;

  // This window is drawing: frames that stop mean something only then.
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return;
    let raf = requestAnimationFrame(function beat() {
      health.beat();
      raf = requestAnimationFrame(beat);
    });
    return () => cancelAnimationFrame(raf);
  }, [health]);

  // Stream inputs (SRT, RTMP, NDI…) and screen captures say themselves whether pictures come in.
  useEffect(() => {
    let alive = true;
    const check = () =>
      void client.streamStatus().then(
        (st) => {
          if (!alive) return;
          for (const s of latest.current.sources) {
            if (s.kind.type !== 'stream' && s.kind.type !== 'screen') continue;
            const one = st[s.id];
            health.setFailed(s.id, one && !one.live ? (one.problem ?? 'The stream isn’t coming in') : null);
          }
        },
        () => {},
      );
    check();
    const id = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [client, health]);

  // The failover itself, a few times a second and whenever something changes.
  useEffect(() => {
    let sent = (latest.current.noSignal ?? []).join('\n');
    let sentAt = 0;
    const tick = () => {
      const s = latest.current;
      const b = backupOf(s);
      const down = health.downAll(
        s.sources.map((x) => x.id),
        b.lostAfterMs,
      );
      const ids = [...down.keys()].sort();
      const key = ids.join('\n');
      // Told again if the show lost it (another event opened), but not on every tick while it travels.
      const now = health.now();
      if (key !== (s.noSignal ?? []).join('\n') && (key !== sent || now - sentAt > 2000)) {
        sent = key;
        sentAt = now;
        void client.dispatch({ type: 'setNoSignal', ids }).catch(() => {});
      }
      // Problem center: a picture that stopped without any other word about it.
      for (const src of s.sources) {
        const why = down.get(src.id);
        const k = `nosignal:${src.id}`;
        if (store && why && (why === 'No picture coming in' || why === 'No signal (test)'))
          store.report(me, {
            key: k,
            level: 'error',
            title: `${src.name}: no signal`,
            detail: 'No picture has come from it for a moment. Screens showing it show the logo instead.',
            fix: 'Check its cable and power. Lumora switches to it again only when you choose (unless “switch back” is on in the backup lineup).',
            sourceId: src.id,
          });
        else store?.clear(me, k);
      }
      const r = failover.current!.step(s, new Set(down.keys()), now);
      for (const a of r.actions) void client.dispatch(a).catch(() => {});
      for (const n of r.notices) log.push(n, s);
      // An input taken back by hand needs no notice any more.
      for (const n of log.active())
        if ((n.kind === 'switched' || n.kind === 'allDown' || n.kind === 'back') && s.screens[n.screen].program === n.from && !down.has(n.from))
          log.settle(n.screen, n.from);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    const stop = health.subscribe(tick);
    return () => {
      clearInterval(id);
      stop();
    };
  }, [client, health, log, store, me, intervalMs]);

  // The notices go to the problem center too (with the take button).
  useEffect(() => {
    if (!store) return;
    let shown = new Set<string>();
    const sync = () => {
      const now = new Set<string>();
      for (const n of log.active()) {
        const key = `backup:${n.screen}:${n.from}`;
        now.add(key);
        store.report(me, {
          key,
          level: n.kind === 'allDown' ? 'error' : 'warning',
          title: noteText(n),
          detail: `At ${clockTime(n.wallAt)}.${n.kind === 'back' ? ' Lumora did not switch back by itself: you decide.' : ''}`,
          action:
            n.kind === 'back'
              ? {
                  label: `Take ${n.fromName}`,
                  run: () => {
                    log.dismiss(n.id);
                    void client.dispatch({ type: 'cutTo', screen: n.screen, sourceId: n.from }).catch(() => {});
                  },
                }
              : undefined,
          sourceId: n.from,
        });
      }
      for (const k of shown) if (!now.has(k)) store.clear(me, k);
      shown = now;
    };
    sync();
    const stop = log.subscribe(sync);
    return () => {
      stop();
      store.clearAll(me, '');
    };
  }, [store, log, me, client]);
  return null;
}

/** The notices at the top of the control window: what switched, and what came back. */
export function BackupNotices({ act, log = backupLog }: { act: (a: Action) => void; log?: BackupLog }) {
  const notes = useSyncExternalStore(log.subscribe, log.active, log.active);
  if (!notes.length) return null;
  return (
    <div className="bnotes" role="status" aria-live="assertive">
      {notes.map((n) => (
        <div key={n.id} className={`bnote bnote--${n.kind}`}>
          {n.kind === 'back' || n.kind === 'switchedBack' ? <RotateCcw aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
          <span className="bnote__text">{noteText(n)}</span>
          <span className="bnote__time">{clockTime(n.wallAt)}</span>
          {n.kind === 'back' && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                log.dismiss(n.id);
                act({ type: 'cutTo', screen: n.screen, sourceId: n.from });
              }}
            >
              Take {n.fromName}
            </button>
          )}
          <button type="button" className="icon" aria-label="Dismiss" title="Dismiss" onClick={() => log.dismiss(n.id)}>
            <X aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

const LOST_AFTER = [500, 1000, 1500, 2000, 3000, 5000];
const FADES: { ms: number; name: string }[] = [
  { ms: 0, name: 'A cut' },
  { ms: 300, name: 'A quick fade' },
  { ms: 600, name: 'A fade' },
  { ms: 1000, name: 'A slow fade' },
];

/** Settings → Backup lineup: on or off, the order, and how it switches. */
export function BackupDialog({
  show,
  act,
  onClose,
  focus = null,
  health = inputHealth,
}: {
  show: Show;
  act: (a: Action) => void;
  onClose: () => void;
  /** The input it was opened from (offered to add to the lineup). */
  focus?: string | null;
  health?: InputHealth;
}) {
  const b = backupOf(show);
  const set = (p: Partial<Backup>) => act({ type: 'updateEvent', patch: { backup: cleanBackup({ ...b, ...p }) } });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const custom = b.lineup.length > 0;
  const lineup = lineupOf(show);
  const name = (id: string) => show.sources.find((s) => s.id === id)?.name ?? id;
  const others = show.sources.filter((s) => canStandIn(s) && !lineup.includes(s.id));
  const [adding, setAdding] = useState('');
  const move = (i: number, by: number) => {
    const l = [...lineup];
    const [x] = l.splice(i, 1);
    l.splice(i + by, 0, x!);
    set({ lineup: l });
  };
  const onAir = show.screens.live.program;
  const [trying, setTrying] = useState(false);
  const focusSrc = focus ? show.sources.find((s) => s.id === focus) : undefined;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Backup lineup" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box bkp">
        <header className="modal__head">
          <h2>
            <ListOrdered className="modal__icon" aria-hidden="true" />
            Backup lineup
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="bkp__body">
          <label className="check bkp__main">
            <input type="checkbox" checked={b.on} onChange={(e) => act({ type: 'setBackupOn', value: e.target.checked })} /> If the input on air loses its
            picture, switch to the next one in the lineup by itself
          </label>
          <p className="field__note">
            A camera that is unplugged, stops sending pictures, or a stream that drops out counts as lost. Inputs that are also out are skipped. If none has a
            picture, the audience sees the logo.
          </p>

          <div className="field">
            <span className="field__label">The lineup</span>
            <div className="bkp__modes" role="radiogroup" aria-label="The lineup">
              <label className="check">
                <input type="radio" name="bkp-mode" checked={!custom} onChange={() => set({ lineup: [] })} /> Automatic: the cameras in input order, then the
                logo
              </label>
              <label className="check">
                <input type="radio" name="bkp-mode" checked={custom} onChange={() => set({ lineup: automaticLineup(show) })} /> My own order
              </label>
            </div>
            <ol className="bkp__list" aria-label="Lineup order">
              {lineup.map((id, i) => {
                const down = show.noSignal?.includes(id);
                return (
                  <li key={id} className={`bkp__item${id === focus ? ' is-focus' : ''}`}>
                    <span className="bkp__num">{i + 1}</span>
                    <span className="bkp__name">{name(id)}</span>
                    {id === onAir && <span className="bkp__tag bkp__tag--air">On air</span>}
                    {down && (
                      <span className="bkp__tag bkp__tag--down">
                        <VideoOff aria-hidden="true" />
                        No signal
                      </span>
                    )}
                    {custom && (
                      <span className="bkp__btns">
                        <button type="button" className="icon" aria-label={`Move ${name(id)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                          <ChevronUp aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon"
                          aria-label={`Move ${name(id)} down`}
                          disabled={i === lineup.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ChevronDown aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon"
                          aria-label={`Take ${name(id)} out of the lineup`}
                          onClick={() => set({ lineup: lineup.filter((x) => x !== id) })}
                        >
                          <X aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
              <li className="bkp__item bkp__item--last">
                <span className="bkp__num">{lineup.length + 1}</span>
                <span className="bkp__name">If none has a picture: the {show.event.onFailure === 'black' ? 'black screen' : 'logo'} (Event setup)</span>
              </li>
            </ol>
            {lineup.length < 2 && (
              <p className="field__note field__note--warn">
                The lineup needs at least two inputs to switch between. Add your cameras as inputs, or choose your own order.
              </p>
            )}
            {custom && others.length > 0 && (
              <div className="bkp__add">
                <select value={adding} aria-label="Input to add" onChange={(e) => setAdding(e.target.value)}>
                  <option value="">Add an input…</option>
                  {others.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  disabled={!adding}
                  onClick={() => {
                    set({ lineup: [...lineup, adding] });
                    setAdding('');
                  }}
                >
                  <Plus aria-hidden="true" />
                  Add
                </button>
              </div>
            )}
            {focusSrc && !lineup.includes(focusSrc.id) && canStandIn(focusSrc) && (
              <button type="button" className="btn bkp__focus" onClick={() => set({ lineup: [...lineup, focusSrc.id] })}>
                <Plus aria-hidden="true" />
                Add {focusSrc.name} to the lineup
              </button>
            )}
          </div>

          <div className="field">
            <span className="field__label">Looks after</span>
            <div className="bkp__screens">
              {(['live', 'back', 'monitor'] as const).map((sc) => (
                <label key={sc} className="check">
                  <input
                    type="checkbox"
                    checked={b.screens.includes(sc)}
                    onChange={(e) => set({ screens: e.target.checked ? [...b.screens, sc] : b.screens.filter((x) => x !== sc) })}
                  />{' '}
                  {SCREEN_NAME[sc]}
                </label>
              ))}
            </div>
          </div>

          <div className="bkp__row">
            <label className="field">
              <span className="field__label">Counts as lost after</span>
              <select value={b.lostAfterMs} onChange={(e) => set({ lostAfterMs: Number(e.target.value) })}>
                {[...new Set([...LOST_AFTER, b.lostAfterMs])]
                  .sort((x, y) => x - y)
                  .map((ms) => (
                    <option key={ms} value={ms}>
                      {ms / 1000} seconds without a picture
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Switches with</span>
              <select value={b.fadeMs} onChange={(e) => set({ fadeMs: Number(e.target.value) })}>
                {[...FADES, ...(FADES.some((f) => f.ms === b.fadeMs) ? [] : [{ ms: b.fadeMs, name: `A ${b.fadeMs / 1000} s fade` }])].map((f) => (
                  <option key={f.ms} value={f.ms}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="check">
            <input type="checkbox" checked={b.switchBack} onChange={(e) => set({ switchBack: e.target.checked })} /> Switch back by itself when it returns
          </label>
          <p className="field__note">
            Off: when a lost input comes back, Lumora tells you and you take it with one click. A take of your own always wins over the lineup.
          </p>

          <div className="bkp__try">
            <button
              type="button"
              className="btn"
              disabled={!onAir || !b.on || trying}
              onClick={() => {
                if (!onAir) return;
                setTrying(true);
                health.simulate(onAir, 6000);
                setTimeout(() => setTrying(false), 6000);
              }}
            >
              <VideoOff aria-hidden="true" />
              {trying ? 'Testing…' : 'Try it'}
            </button>
            <span className="field__note">
              {onAir ? `Pretends ${name(onAir)} (on air now) loses its picture for 6 seconds. Best during a rehearsal.` : 'Put something on air first.'}
            </span>
          </div>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
