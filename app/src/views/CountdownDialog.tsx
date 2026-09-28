import { useEffect, useState } from 'react';
import type { AtZero } from '../engine/types/AtZero';
import type { Show } from '../engine/types/Show';
import type { TimerFormat } from '../engine/types/TimerFormat';
import { CountdownOverlay } from '../components/CountdownOverlay';
import type { Act } from './act';

const MIN = 60_000;
const LENGTHS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];

/** Parse "5", "5:30", "1:05:00" into ms. */
export function parseLength(text: string): number | null {
  const parts = text
    .trim()
    .split(':')
    .map((p) => (p === '' ? NaN : Number(p)));
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const [a = 0, b = 0, c = 0] = parts;
  const ms = parts.length === 1 ? a * MIN : parts.length === 2 ? (a * 60 + b) * 1000 : (a * 3600 + b * 60 + c) * 1000;
  return ms > 0 && ms <= 24 * 60 * MIN ? Math.round(ms) : null;
}

/** The next time the clock shows "HH:MM" (today, or tomorrow if it has passed). */
export function nextClockTime(hhmm: string, now: Date): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const t = new Date(now);
  t.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

const ENDINGS: { type: AtZero['type']; name: string }[] = [
  { type: 'hold', name: 'Stay on 0' },
  { type: 'showText', name: 'Show the end text' },
  { type: 'hide', name: 'Take the countdown off' },
  { type: 'blank', name: 'Go to black' },
  { type: 'cutTo', name: 'Switch the Live Screen to…' },
];

const FORMATS: { f: TimerFormat; name: string }[] = [
  { f: 'auto', name: 'Automatic' },
  { f: 'minSec', name: 'mm:ss' },
  { f: 'hourMinSec', name: 'h:mm:ss' },
];

/** Everything about the countdown: length or start time, words, look, and what happens at zero. */
export function CountdownDialog({ show, act, onClose }: { show: Show; act: Act; onClose: () => void }) {
  const c = show.countdown;
  const [length, setLength] = useState('');
  const [at, setAt] = useState('');
  const [label, setLabel] = useState(c.label);
  const [endText, setEndText] = useState(c.endText);
  // Words are saved when leaving the box or closing, so spaces can be typed freely.
  const close = () => {
    const patch: { label?: string; endText?: string } = {};
    if (label !== c.label) patch.label = label;
    if (endText !== c.endText) patch.endText = endText;
    if (Object.keys(patch).length) act({ type: 'updateCountdown', patch });
    onClose();
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  });

  const parsed = parseLength(length);
  const target = nextClockTime(at, new Date());
  const cutSource = c.atZero.type === 'cutTo' ? c.atZero.sourceId : show.sources[0]?.id;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Countdown"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal__box cdset">
        <header className="modal__head">
          <h2>Countdown</h2>
          <button type="button" className="icon" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>
        <div className="cdset__body">
          <div className="cdset__col">
            <div className="field">
              <span className="field__label">Length</span>
              <div className="cdset__grid">
                {LENGTHS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="seg"
                    aria-pressed={c.lengthMs === n * MIN}
                    onClick={() => act({ type: 'setCountdownLength', lengthMs: n * MIN })}
                  >
                    {n} min
                  </button>
                ))}
              </div>
              <div className="cdset__inline">
                <input
                  className="text"
                  placeholder="Other, e.g. 7:30"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  aria-label="Other length"
                />
                <button
                  type="button"
                  className="btn"
                  disabled={parsed === null}
                  onClick={() => parsed !== null && (act({ type: 'setCountdownLength', lengthMs: parsed }), setLength(''))}
                >
                  Set
                </button>
              </div>
            </div>
            <div className="field">
              <span className="field__label">Or count down to a time</span>
              <div className="cdset__inline">
                <input className="text" type="time" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Starts at" />
                <button
                  type="button"
                  className="btn"
                  disabled={target === null}
                  onClick={() => target !== null && act({ type: 'countdownTo', at: target })}
                >
                  Count down to it
                </button>
              </div>
              <span className="field__note">It starts counting straight away and reaches zero at that time.</span>
            </div>
            <label className="field">
              <span className="field__label">Words above the numbers</span>
              <input
                className="text"
                value={label}
                maxLength={60}
                placeholder="e.g. Starting soon"
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <div className="field">
              <span className="field__label">How the time is written</span>
              <div className="segs">
                {FORMATS.map((f) => (
                  <button
                    key={f.f}
                    type="button"
                    className="seg"
                    aria-pressed={c.format === f.f}
                    onClick={() => act({ type: 'updateCountdown', patch: { format: f.f } })}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="cdset__col">
            <div className="cdset__preview">
              <CountdownOverlay countdown={{ ...c, onLive: true }} screen="live" />
            </div>
            <div className="field">
              <span className="field__label">When it reaches zero</span>
              <select
                aria-label="When it reaches zero"
                value={c.atZero.type}
                onChange={(e) => {
                  const type = e.target.value as AtZero['type'];
                  if (type === 'cutTo') {
                    if (cutSource) act({ type: 'updateCountdown', patch: { atZero: { type, sourceId: cutSource } } });
                  } else act({ type: 'updateCountdown', patch: { atZero: { type } as AtZero } });
                }}
              >
                {ENDINGS.map((z) => (
                  <option key={z.type} value={z.type} disabled={z.type === 'cutTo' && show.sources.length === 0}>
                    {z.name}
                  </option>
                ))}
              </select>
              {c.atZero.type === 'cutTo' && (
                <select
                  aria-label="Switch to"
                  value={c.atZero.sourceId}
                  onChange={(e) => act({ type: 'updateCountdown', patch: { atZero: { type: 'cutTo', sourceId: e.target.value } } })}
                >
                  {show.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {c.atZero.type === 'showText' && (
              <label className="field">
                <span className="field__label">End text</span>
                <input className="text" value={endText} maxLength={60} onChange={(e) => setEndText(e.target.value)} />
              </label>
            )}
            <div className="field">
              <span className="field__label">Show the big countdown on</span>
              <div className="segs">
                <button
                  type="button"
                  className="seg"
                  aria-pressed={c.onLive}
                  onClick={() => act({ type: 'updateCountdown', patch: { onLive: !c.onLive } })}
                >
                  Live Screen
                </button>
                <button
                  type="button"
                  className="seg"
                  aria-pressed={c.onBack}
                  onClick={() => act({ type: 'updateCountdown', patch: { onBack: !c.onBack } })}
                >
                  Back Screen
                </button>
              </div>
              <span className="field__note">The stage monitor shows it too when “Timer” is on there.</span>
            </div>
          </div>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn--primary" onClick={close}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
