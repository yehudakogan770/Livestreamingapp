// The font picker: every font shown in its own face, the event look's two
// fonts first (they follow the event), then the title's own fonts, then the
// ones on hand; type to find one, or any installed font by name.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export const FONT_LIST = [
  'Inter',
  'Heebo',
  'Bebas Neue',
  'Chakra Petch',
  'Frank Ruhl Libre',
  'David Libre',
  'Great Vibes',
  'Segoe UI',
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Calibri',
  'Georgia',
  'Times New Roman',
  'Consolas',
];

export function FontPicker({
  value,
  onChange,
  brand,
  own,
  label = 'Font',
}: {
  value: string;
  onChange: (font: string) => void;
  /** The event look's main and second font (as they are now). */
  brand: { font: string; fontSub: string };
  /** Fonts that came with the title (its font files). */
  own: string[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  const shown = (f: string) => (f === '$font' ? brand.font : f === '$fontSub' ? brand.fontSub : f);
  const name = (f: string) => (f === '$font' ? `Event main font (${brand.font})` : f === '$fontSub' ? `Event second font (${brand.fontSub})` : f);
  const groups = useMemo(() => {
    const match = (f: string) => !q.trim() || name(f).toLowerCase().includes(q.trim().toLowerCase());
    return [
      ['Event look', ['$font', '$fontSub']],
      ['In this title', own],
      ['Fonts', FONT_LIST.filter((f) => !own.includes(f))],
    ]
      .map(([g, list]) => [g, (list as string[]).filter(match)] as [string, string[]])
      .filter(([, list]) => list.length);
  }, [q, own, brand.font, brand.fontSub]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (f: string) => {
    onChange(f);
    setOpen(false);
    setQ('');
  };
  const any = q.trim() && !groups.some(([, l]) => l.some((f) => f.toLowerCase() === q.trim().toLowerCase()));
  return (
    <div className="tt-font" ref={wrap}>
      <button type="button" className="tt-font-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)} style={{ fontFamily: `"${shown(value)}"` }}>
        <span>{name(value)}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="tt-font-pop" role="listbox" aria-label="Fonts">
          <input
            className="tt-input"
            autoFocus
            placeholder="Find a font, or type any installed font"
            aria-label="Find a font"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter') {
                const first = groups[0]?.[1][0];
                if (any) pick(q.trim());
                else if (first) pick(first);
              }
            }}
          />
          <div className="tt-font-list">
            {groups.map(([g, list]) => (
              <div key={g}>
                <div className="tt-font-group">{g}</div>
                {list.map((f) => (
                  <button
                    key={f}
                    role="option"
                    aria-selected={f === value}
                    className={`tt-font-item${f === value ? ' on' : ''}`}
                    style={{ fontFamily: `"${shown(f)}", system-ui` }}
                    onClick={() => pick(f)}
                  >
                    {name(f)}
                  </button>
                ))}
              </div>
            ))}
            {any && (
              <button className="tt-font-item" onClick={() => pick(q.trim())} style={{ fontFamily: `"${q.trim()}", system-ui` }}>
                Use “{q.trim()}”
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
