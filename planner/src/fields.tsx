import { useState } from 'react';
import { clock24, formatDuration, parseClock, parseDuration, showClock } from './model';

interface FieldProps {
  className?: string;
  readOnly?: boolean;
  placeholder?: string;
  label: string;
}

/** A time of day: typed as "7:30 PM" or "19:30", stored as "19:30" ('' when empty). */
export function ClockInput({ value, onChange, className, readOnly, placeholder, label }: FieldProps & { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && draft.trim() !== '' && parseClock(draft) === null;
  const commit = () => {
    if (draft === null) return;
    const t = draft.trim();
    if (!t) onChange('');
    else {
      const s = parseClock(t);
      if (s !== null) onChange(clock24(s));
    }
    setDraft(null);
  };
  return (
    <input
      className={`${className ?? 'input'}${bad ? ' is-bad' : ''}`}
      value={draft ?? showClock(value)}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-label={label}
      aria-invalid={bad || undefined}
      title={bad ? 'Write a time like 7:30 PM or 19:30' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** A length: typed as "5:00", "90" (seconds), "5m" or "1h 30m"; stored in seconds (null when empty). */
export function DurationInput({
  value,
  onChange,
  className,
  readOnly,
  placeholder,
  label,
}: FieldProps & { value: number | null; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && draft.trim() !== '' && parseDuration(draft) === null;
  const commit = () => {
    if (draft === null) return;
    const t = draft.trim();
    if (!t) onChange(null);
    else {
      const s = parseDuration(t);
      if (s !== null) onChange(Math.min(s, 86_400));
    }
    setDraft(null);
  };
  return (
    <input
      className={`${className ?? 'input'}${bad ? ' is-bad' : ''}`}
      value={draft ?? formatDuration(value)}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-label={label}
      aria-invalid={bad || undefined}
      title={bad ? 'Write a length like 5:00, 90 (seconds) or 1h 30m' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** A time of day with the phone's own time picker; stored as "19:30" ('' when empty). */
export function TimeInput({ value, onChange, className, readOnly, label }: Omit<FieldProps, 'placeholder'> & { value: string; onChange: (v: string) => void }) {
  const secs = parseClock(value);
  return (
    <input
      type="time"
      className={className ?? 'input'}
      value={secs === null ? '' : clock24(secs)}
      step={secs !== null && secs % 60 ? 1 : 60}
      readOnly={readOnly}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const digits = (s: string) => s.replace(/\D/g, '').slice(0, 4);

/** A length as minutes and seconds, each on the number keypad; stored in seconds (null when both are empty). */
export function MinSecInput({
  value,
  onChange,
  readOnly,
  label,
}: Omit<FieldProps, 'placeholder' | 'className'> & { value: number | null; onChange: (v: number | null) => void }) {
  const [min, setMin] = useState<string | null>(null);
  const [sec, setSec] = useState<string | null>(null);
  const m = min ?? (value === null ? '' : String(Math.floor(value / 60)));
  const s = sec ?? (value === null ? '' : String(value % 60).padStart(2, '0'));
  const commit = () => {
    if (min === null && sec === null) return;
    if (!m && !s) onChange(null);
    else onChange(Math.min(Number(m || 0) * 60 + Number(s || 0), 86_400));
    setMin(null);
    setSec(null);
  };
  const common = {
    className: 'input',
    inputMode: 'numeric' as const,
    pattern: '[0-9]*',
    enterKeyHint: 'done' as const,
    readOnly,
    onBlur: commit,
    onKeyDown: (e: { key: string; target: EventTarget }) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    },
  };
  return (
    <span className="minsec" role="group" aria-label={label}>
      <input {...common} value={m} placeholder="0" aria-label={`${label}, minutes`} onChange={(e) => setMin(digits(e.target.value))} />
      <span className="minsec__unit">min</span>
      <input {...common} value={s} placeholder="00" aria-label={`${label}, seconds`} onChange={(e) => setSec(digits(e.target.value).slice(0, 2))} />
      <span className="minsec__unit">sec</span>
    </span>
  );
}
