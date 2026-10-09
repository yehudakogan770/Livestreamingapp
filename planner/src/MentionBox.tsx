import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { initials } from './model';
import { insertMention, matchPeople, splitMentions, typingMention, type Mentionable } from './mentions';

/**
 * A text box where "@" offers the people on the plan (↑/↓ and Enter or Tab
 * to pick). `onKeyDown` still gets the keys the list does not use.
 */
export function MentionBox({
  value,
  onChange,
  people,
  me,
  className = 'input',
  rows = 2,
  maxLength,
  placeholder,
  label,
  onKeyDown,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  people: readonly Mentionable[];
  me: string;
  className?: string;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  label: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [at, setAt] = useState<{ start: number; query: string } | null>(null);
  const [i, setI] = useState(0);
  const found = at ? matchPeople(people, at.query, me) : [];
  const open = !!at && found.length > 0;
  const check = (el: HTMLTextAreaElement) => {
    const t = typingMention(el.value, el.selectionStart ?? el.value.length);
    setAt(t);
    setI(0);
  };
  const pick = (p: Mentionable) => {
    const el = ref.current;
    if (!el || !at) return;
    const r = insertMention(value, at.start, el.selectionStart ?? value.length, p);
    onChange(r.text);
    setAt(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    });
  };
  return (
    <div className="mention">
      <textarea
        ref={ref}
        className={className}
        rows={rows}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={open}
        onChange={(e) => {
          onChange(e.target.value);
          check(e.target);
        }}
        onClick={(e) => check(e.currentTarget)}
        onBlur={() => setTimeout(() => setAt(null), 150)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setI((n) => (n + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length);
              return;
            }
            if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
              e.preventDefault();
              pick(found[i]!);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setAt(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      {open && (
        <ul className="mention__list" role="listbox" aria-label="People on this plan">
          {found.map((p, n) => (
            <li key={p.userId} role="option" aria-selected={n === i}>
              <button
                type="button"
                className={`mention__opt${n === i ? ' is-on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
              >
                <span className="avatar avatar--sm" aria-hidden="true">
                  {initials(p.name || p.email)}
                </span>
                <b>{p.name || p.email}</b>
                {p.name && <span className="muted small">{p.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Text with the @mentions of people on the plan shown bold. */
export function WithMentions({ text, people }: { text: string; people: readonly Mentionable[] }): ReactNode {
  return (
    <>
      {splitMentions(text, people).map((p, i) =>
        p.mention ? (
          <b key={i} className="mention__name">
            {p.text}
          </b>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
