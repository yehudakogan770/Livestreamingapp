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
