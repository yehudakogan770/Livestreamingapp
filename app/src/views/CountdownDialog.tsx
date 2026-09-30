import { useEffect, useState } from 'react';
import type { AtZero } from '../engine/types/AtZero';
import type { Countdown } from '../engine/types/Countdown';
import type { Show } from '../engine/types/Show';
import type { TimerFormat } from '../engine/types/TimerFormat';
import { CountdownView } from '../components/CountdownOverlay';
import type { Act } from './act';
import { defaultCountdown } from '../engine/client';

const MIN = 60_000;
const LENGTHS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
const BACKGROUNDS = ['#0b2545', '#1f6f79', '#3b1c32', '#1a1d22', '#000000', '#5a1f1a'];

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
  { type: 'takeNext', name: 'Go to what is in Next' },
  { type: 'hide', name: 'Numbers go, event logo appears (background stays)' },
  { type: 'showText', name: 'Show the end text' },
  { type: 'hold', name: 'Stay on 0' },
  { type: 'blank', name: 'Go to black' },
  { type: 'cutTo', name: 'Switch the Live Screen to…' },
];

const FORMATS: { f: TimerFormat; name: string }[] = [
  { f: 'auto', name: 'Automatic' },
  { f: 'minSec', name: 'mm:ss' },
  { f: 'hourMinSec', name: 'h:mm:ss' },
];

const fmtLength = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s % 60 === 0 ? String(s / 60) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Everything about the countdown. Nothing changes on the screens until
 * Done; Cancel (or ✕ / Esc) forgets the changes.
 */
export function CountdownDialog({ show, id, act, onClose }: { show: Show; id: string; act: Act; onClose: () => void }) {
  // Only this countdown input changes; others (say, the one on air) are untouched.
  const src = show.sources.find((s) => s.id === id);
  const kind = src?.kind.type === 'countdown' ? src.kind : null;
  const c = kind?.timer ?? defaultCountdown();
  const firstBg = kind?.background ?? BACKGROUNDS[0]!;

  const [mode, setMode] = useState<'length' | 'clock'>('length');
  const [length, setLength] = useState(fmtLength(c.lengthMs));
  const [at, setAt] = useState('');
  const [label, setLabel] = useState(c.label);
  const [endText, setEndText] = useState(c.endText);
  const [format, setFormat] = useState<TimerFormat>(c.format);
  const [atZero, setAtZero] = useState<AtZero>(c.atZero);
  const [background, setBackground] = useState(firstBg);

  const lengthMs = parseLength(length);
  const target = nextClockTime(at, new Date());
  const valid = mode === 'length' ? lengthMs !== null : target !== null;

  const done = () => {
    if (!valid) return;
    if (mode === 'length' && lengthMs !== c.lengthMs && lengthMs !== null) act({ type: 'setCountdownLength', id, lengthMs });
    if (mode === 'clock' && target !== null) act({ type: 'countdownTo', id, at: target });
    const patch: Record<string, unknown> = {};
    if (label !== c.label) patch.label = label;
    if (endText !== c.endText) patch.endText = endText;
    if (format !== c.format) patch.format = format;
    if (JSON.stringify(atZero) !== JSON.stringify(c.atZero)) patch.atZero = atZero;
    if (Object.keys(patch).length) act({ type: 'updateCountdown', id, patch });
    if (kind && kind.background !== background) act({ type: 'updateSource', id, patch: { color: background } });
    onClose();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  // The preview shows the settings being chosen, not what is on air.
  const draft: Countdown = {
    ...c,
    label,
    endText,
    format,
    atZero,
    ...(c.endsAt === null && mode === 'length' && lengthMs !== null && lengthMs !== c.lengthMs ? { remainingMs: lengthMs } : {}),
  };
  const cutSource = atZero.type === 'cutTo' ? atZero.sourceId : show.sources.find((s) => s.kind.type !== 'microphone')?.id;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Countdown" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box cdset">
        <header className="modal__head">
          <h2>Countdown · {src?.name ?? 'Countdown'}</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="cdset__body">
          <div className="cdset__col">
            <div className="segs">
              <button type="button" className="seg" aria-pressed={mode === 'length'} onClick={() => setMode('length')}>
                Count down a length
              </button>
              <button type="button" className="seg" aria-pressed={mode === 'clock'} onClick={() => setMode('clock')}>
                Count down to a time
              </button>
            </div>
            {mode === 'length' ? (
              <div className="field">
                <span className="field__label">Length</span>
                <div className="cdset__grid">
                  {LENGTHS.map((n) => (
                    <button key={n} type="button" className="seg" aria-pressed={lengthMs === n * MIN} onClick={() => setLength(String(n))}>
                      {n} min
                    </button>
                  ))}
                </div>
                <input className="text" placeholder="Or type it, e.g. 7:30" value={length} onChange={(e) => setLength(e.target.value)} aria-label="Length" />
                <span className="field__note">
                  {lengthMs === null ? 'Type minutes, or m:ss, or h:mm:ss.' : 'Setting a new length stops the countdown, ready to start.'}
                </span>
              </div>
            ) : (
              <div className="field">
                <span className="field__label">Reaches zero at</span>
                <input className="text" type="time" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Reaches zero at" />
                <span className="field__note">It starts counting when you press Done.</span>
              </div>
            )}
            <label className="field">
              <span className="field__label">Words above the numbers</span>
              <input className="text" value={label} maxLength={60} placeholder="e.g. Starting soon" onChange={(e) => setLabel(e.target.value)} />
            </label>
            <div className="field">
              <span className="field__label">How the time is written</span>
              <div className="segs">
                {FORMATS.map((f) => (
                  <button key={f.f} type="button" className="seg" aria-pressed={format === f.f} onClick={() => setFormat(f.f)}>
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="cdset__col">
            <div className="cdset__preview">
              <CountdownView countdown={draft} background={background} />
            </div>
            <div className="field">
              <span className="field__label">Background</span>
              <div className="addinput__swatches">
                {BACKGROUNDS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className="swatch"
                    aria-label={b}
                    aria-pressed={background === b}
                    style={{ background: b }}
                    onClick={() => setBackground(b)}
                  />
                ))}
                <input type="color" aria-label="Any colour" value={background} onChange={(e) => setBackground(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <span className="field__label">When it reaches zero</span>
              <select
                aria-label="When it reaches zero"
                value={atZero.type}
                onChange={(e) => {
                  const type = e.target.value as AtZero['type'];
                  if (type === 'cutTo') {
                    if (cutSource) setAtZero({ type, sourceId: cutSource });
                  } else setAtZero({ type } as AtZero);
                }}
              >
                {ENDINGS.map((z) => (
                  <option key={z.type} value={z.type} disabled={z.type === 'cutTo' && !cutSource}>
                    {z.name}
                  </option>
                ))}
              </select>
              {atZero.type === 'cutTo' && (
                <select aria-label="Switch to" value={atZero.sourceId} onChange={(e) => setAtZero({ type: 'cutTo', sourceId: e.target.value })}>
                  {show.sources
                    .filter((s) => s.kind.type !== 'microphone')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              )}
            </div>
            {atZero.type === 'showText' && (
              <label className="field">
                <span className="field__label">End text</span>
                <input className="text" value={endText} maxLength={60} onChange={(e) => setEndText(e.target.value)} />
              </label>
            )}
            <span className="field__note">To show it: click the Countdown tile (or “Put in Next”), then TAKE.</span>
          </div>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!valid} onClick={done}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
