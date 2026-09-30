import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { builtInFonts, SYSTEM_FONTS, type FontCategory, type FontInfo } from '../engine/fonts';
import './FontPicker.css';

type Group = 'all' | 'hebrew' | FontCategory;
const GROUPS: [Group, string][] = [
  ['all', 'All'],
  ['hebrew', 'עברית Hebrew'],
  ['Sans Serif', 'Sans'],
  ['Serif', 'Serif'],
  ['Display', 'Display'],
  ['Handwriting', 'Handwriting'],
  ['Monospace', 'Mono'],
  ['System', 'On this computer'],
  ['Added', 'Added'],
];

/**
 * Choose a font from the hundreds built in (and the event's own, and the
 * computer's): a search, groups, and every font shown in itself.
 */
export function FontPicker({
  value,
  onChange,
  added = [],
  label = 'Font',
  sameLabel,
}: {
  value: string;
  onChange: (font: string) => void;
  /** Fonts added for the event (font files). */
  added?: string[];
  label?: string;
  /** Offer "the same as the other" (value ""), with this wording. */
  sameLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState<FontInfo[]>([]);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>('all');
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (open && !fonts.length) void builtInFonts().then(setFonts);
  }, [open, fonts.length]);
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const w = 460;
    const h = 420;
    setPlace({
      left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left)),
      top: r.bottom + h + 8 < window.innerHeight ? r.bottom + 4 : Math.max(8, r.top - h - 4),
    });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  const all = useMemo(() => {
    const mine: FontInfo[] = added.map((family) => ({ family, category: 'Added', hebrew: true }));
    const seen = new Set<string>();
    return [...mine, ...fonts, ...SYSTEM_FONTS].filter((f) => !seen.has(f.family) && seen.add(f.family));
  }, [added, fonts]);
  const shown = all.filter(
    (f) =>
      (group === 'all' || (group === 'hebrew' ? f.hebrew : f.category === group)) && (!q.trim() || f.family.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const pick = (f: string) => {
    onChange(f);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="fpk__btn"
        aria-label={label}
        aria-expanded={open}
        style={value ? { fontFamily: `"${value}", system-ui` } : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{value || sameLabel || 'Choose a font'}</span>
        <i>▾</i>
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="fpk" role="dialog" aria-label={`${label}: choose`} style={place}>
            <input
              className="text"
              autoFocus
              value={q}
              placeholder={`Search ${all.length} fonts`}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search fonts"
            />
            <div className="fpk__groups">
              {GROUPS.filter(([g]) => g !== 'Added' || added.length).map(([g, name]) => (
                <button key={g} type="button" className={`fpk__group${group === g ? ' is-on' : ''}`} aria-pressed={group === g} onClick={() => setGroup(g)}>
                  {name}
                </button>
              ))}
            </div>
            <div className="fpk__list" role="listbox" aria-label="Fonts">
              {sameLabel !== undefined && (
                <button
                  type="button"
                  role="option"
                  aria-selected={value === ''}
                  className={`fpk__font${value === '' ? ' is-on' : ''}`}
                  onClick={() => pick('')}
                >
                  <b>{sameLabel}</b>
                </button>
              )}
              {shown.map((f) => (
                <button
                  key={f.family}
                  type="button"
                  role="option"
                  aria-selected={value === f.family}
                  className={`fpk__font${value === f.family ? ' is-on' : ''}`}
                  onClick={() => pick(f.family)}
                  title={f.family}
                >
                  <b style={{ fontFamily: `"${f.family}", system-ui` }}>{f.family}</b>
                  <span style={{ fontFamily: `"${f.family}", system-ui` }}>{f.hebrew ? 'אבג Aa' : 'Aa 123'}</span>
                </button>
              ))}
              {shown.length === 0 && <p className="field__note">No font by that name.</p>}
            </div>
            {q.trim() && !all.some((f) => f.family.toLowerCase() === q.trim().toLowerCase()) && (
              <button type="button" className="btn btn--small" onClick={() => pick(q.trim())}>
                Use “{q.trim()}” (a font on this computer)
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
