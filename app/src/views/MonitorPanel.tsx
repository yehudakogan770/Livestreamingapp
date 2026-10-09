import { useState } from 'react';
import type { MonitorLayout } from '../engine/types/MonitorLayout';
import type { Show } from '../engine/types/Show';
import type { TextSize } from '../engine/types/TextSize';
import { MonitorScreen } from '../components/MonitorScreen';
import { CountdownCard } from './CountdownCard';
import type { Act } from './act';
import { prompterAt, prompterLength } from '../components/PrompterView';
import { useNow } from '../engine/useNow';

/** The teleprompter: small until opened; the script, run, speed and size. */
function PrompterPanel({ show, act }: { show: Show; act: Act }) {
  const p = show.monitor.prompter;
  const [open, setOpen] = useState(p.on);
  const [script, setScript] = useState(p.script);
  const now = useNow(p.since !== null, 500);
  const running = p.since !== null;
  const save = (x: Partial<{ on: boolean; script: string; size: number; mirror: boolean }>) =>
    act({ type: 'updatePrompter', on: p.on, script, size: p.size, mirror: p.mirror, ...x });
  return (
    <div className="field prompt">
      <div className="mpanel__row">
        <button type="button" className={`btn${p.on ? ' is-on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          Teleprompter{p.on ? ' · on the monitor' : ''} {open ? '▴' : '▾'}
        </button>
        {p.on && (
          <>
            <button type="button" className="btn btn--primary" onClick={() => act({ type: 'prompterRun', run: !running })}>
              {running ? '❚❚ Pause' : '▶ Scroll'}
            </button>
            <button type="button" className="btn" aria-label="Slower" onClick={() => act({ type: 'prompterSpeed', speed: p.speed / 1.2 })}>
              −
            </button>
            <span className="mpanel__label">{p.speed.toFixed(1)}</span>
            <button type="button" className="btn" aria-label="Faster" onClick={() => act({ type: 'prompterSpeed', speed: p.speed * 1.2 })}>
              +
            </button>
          </>
        )}
      </div>
      {open && (
        <>
          <textarea
            className="text prompt__script"
            dir="auto"
            rows={6}
            value={script}
            placeholder="Paste the speaker's script here"
            onChange={(e) => setScript(e.target.value)}
            onBlur={() => save({ script })}
            aria-label="Script"
          />
          <div className="mpanel__row">
            <label className="check">
              <input type="checkbox" checked={p.on} onChange={(e) => save({ on: e.target.checked })} /> Show on the stage monitor
            </label>
            <label className="check">
              <input type="checkbox" checked={p.mirror} onChange={(e) => save({ mirror: e.target.checked })} /> Mirror (glass prompter)
            </label>
            <button type="button" className="btn btn--small" onClick={() => act({ type: 'prompterJump', pos: 0 })}>
              ⤒ Back to the start
            </button>
          </div>
          <label className="mpanel__row">
            <span className="mpanel__label">Where</span>
            <input
              type="range"
              min={0}
              max={prompterLength(p)}
              step={0.5}
              value={Math.min(prompterLength(p), prompterAt(p, now))}
              onChange={(e) => act({ type: 'prompterJump', pos: Number(e.target.value) })}
              aria-label="Where in the script"
              style={{ flex: 1 }}
            />
          </label>
          <label className="mpanel__row">
            <span className="mpanel__label">Size</span>
            <input
              type="range"
              min={3}
              max={20}
              step={0.5}
              value={p.size}
              onChange={(e) => save({ size: Number(e.target.value) })}
              aria-label="Text size"
              style={{ flex: 1 }}
            />
          </label>
        </>
      )}
    </div>
  );
}

const LAYOUTS: { id: MonitorLayout; name: string }[] = [
  { id: 'full', name: 'Full' },
  { id: 'stack', name: 'Message + time below' },
  { id: 'split', name: 'Side by side' },
];
const SIZES: { id: TextSize; name: string }[] = [
  { id: 's', name: 'S' },
  { id: 'm', name: 'M' },
  { id: 'l', name: 'L' },
  { id: 'xl', name: 'XL' },
];

/** The Monitor tab: what the people on stage see, and everything to change it. */
export function MonitorPanel({ show, act }: { show: Show; act: Act }) {
  const m = show.monitor;
  const sc = show.screens.monitor;
  const [draft, setDraft] = useState(m.message);
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setDraft(t);
    act({ type: 'updateMonitor', patch: { message: t, messageOn: true } });
  };
  const showing = m.messageOn && m.message;

  return (
    <section className="stage stage--monitor">
      <div className="mon mon--pgm">
        <div className="mon__head">
          <span className="dot dot--pgm" /> On the stage monitor
          <em>{showing ? `“${m.message}”` : 'time only'}</em>
        </div>
        <div className="mon__screen">
          <MonitorScreen show={show} />
          {sc.blank && (
            <span className="mon__blanked">
              BLANKED — the stage sees black
              <small>Click “Monitor” next to Blank, or press B, to show it again</small>
            </span>
          )}
        </div>
        <div className="mpanel__row">
          <span className="mpanel__label">Layout</span>
          <span className="segs">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                className="seg"
                aria-pressed={m.layout === l.id}
                onClick={() => act({ type: 'updateMonitor', patch: { layout: l.id } })}
              >
                {l.name}
              </button>
            ))}
          </span>
          <span className="mpanel__label">Text</span>
          <span className="segs">
            {SIZES.map((z) => (
              <button
                key={z.id}
                type="button"
                className="seg"
                aria-pressed={m.textSize === z.id}
                onClick={() => act({ type: 'updateMonitor', patch: { textSize: z.id } })}
              >
                {z.name}
              </button>
            ))}
          </span>
        </div>
      </div>

      <div className="mpanel">
        <div className="field">
          <span className="field__label">Message for the stage</span>
          <form
            className="mpanel__send"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input
              className="text"
              value={draft}
              maxLength={200}
              placeholder="Type a message and press Enter"
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Message"
            />
            <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
              Show
            </button>
          </form>
          <div className="mpanel__actions">
            <button type="button" className="btn" disabled={!m.messageOn} onClick={() => act({ type: 'updateMonitor', patch: { messageOn: false } })}>
              Clear message
            </button>
            <button type="button" className="btn" onClick={() => act({ type: 'monitorFlash' })}>
              Flash to get attention
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field__label">Quick messages · click to show</span>
          <div className="mpanel__quick">
            {m.quick.map((q, i) =>
              editing === i ? (
                <form
                  key={i}
                  className="mpanel__qedit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act({ type: 'setQuickMessage', index: i, text: editText });
                    setEditing(null);
                  }}
                >
                  <input
                    className="text"
                    autoFocus
                    value={editText}
                    maxLength={60}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                    aria-label={`Quick message ${i + 1}`}
                  />
                </form>
              ) : (
                <div key={i} className={`mpanel__q${showing && m.message === q ? ' is-on' : ''}`}>
                  <button type="button" className="mpanel__qtext" disabled={!q} onClick={() => send(q)}>
                    {q || 'Empty'}
                  </button>
                  <button type="button" className="mpanel__qpen" aria-label={`Edit quick message ${i + 1}`} onClick={() => (setEditing(i), setEditText(q))}>
                    ✎
                  </button>
                </div>
              ),
            )}
          </div>
        </div>

        <div className="mpanel__row">
          <label className="check">
            <input type="checkbox" checked={m.showClock} onChange={(e) => act({ type: 'updateMonitor', patch: { showClock: e.target.checked } })} /> Clock
          </label>
          <label className="check">
            <input type="checkbox" checked={m.clock24h} onChange={(e) => act({ type: 'updateMonitor', patch: { clock24h: e.target.checked } })} /> 24-hour
          </label>
          <label className="check">
            <input type="checkbox" checked={m.showTimer} onChange={(e) => act({ type: 'updateMonitor', patch: { showTimer: e.target.checked } })} /> Countdown
          </label>
          <label className="check" title="When a song is on air on the Live Screen, its words (and the next lines) show here">
            <input type="checkbox" checked={m.showLyrics ?? true} onChange={(e) => act({ type: 'updateMonitor', patch: { showLyrics: e.target.checked } })} />{' '}
            Song words
          </label>
        </div>
        {m.showTimer && (
          <div className="mpanel__row" role="group" aria-label="Speaker timing">
            <label className="check" title="The time left turns amber this long before the end (red in the last minute)">
              Amber at{' '}
              <select
                value={m.wrapUpS ?? 120}
                onChange={(e) => act({ type: 'updateMonitor', patch: { wrapUpS: Number(e.target.value) } })}
                aria-label="Turn amber this long before the end"
              >
                <option value={0}>never</option>
                {[1, 2, 3, 5, 10, 15].map((min) => (
                  <option key={min} value={min * 60}>
                    {min} min left
                  </option>
                ))}
              </select>
            </label>
            <label className="check" title="After zero, show how far over the time is (+1:05) in red">
              <input type="checkbox" checked={m.overtime ?? true} onChange={(e) => act({ type: 'updateMonitor', patch: { overtime: e.target.checked } })} />{' '}
              Time over
            </label>
            <label className="check" title="A bar under the time left shows how much of it has gone">
              <input type="checkbox" checked={m.progress ?? true} onChange={(e) => act({ type: 'updateMonitor', patch: { progress: e.target.checked } })} />{' '}
              Progress bar
            </label>
          </div>
        )}

        <PrompterPanel show={show} act={act} />
        <CountdownCard show={show} act={act} />
      </div>
    </section>
  );
}
