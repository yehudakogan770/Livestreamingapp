// Small inputs used across the designer: numbers you can drag, colors with
// brand tokens, selects and toggles.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TOKEN_KEYS, TOKEN_LABELS, isHex, resolveColor } from '../core/binding';
import type { BrandTokens, Values } from '../core/types';
import { evalMath } from './math';

const fmt = (v: number) => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
};

/**
 * A number: type it (sums work: "100+20", "*2" from the current value), or
 * drag across it to change it (Shift: ten times faster, Alt: a tenth).
 */
export function NumberField({
  value,
  onChange,
  step = 1,
  min,
  max,
  label,
  unit,
  onBegin,
  onEnd,
  wide,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  label: string;
  unit?: string;
  onBegin?: () => void;
  onEnd?: () => void;
  wide?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <span className={`tt-num${wide ? ' wide' : ''}`}>
      <input
        aria-label={label}
        value={text ?? fmt(value)}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          if (text !== null) {
            const n = evalMath(text, value);
            if (n !== null) onChange(clamp(n));
          }
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(null);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
          }
        }}
        onPointerDown={(e) => {
          if (document.activeElement === e.target) return;
          drag.current = { x: e.clientX, v: value, moved: false };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) < 3) return;
          if (!d.moved) {
            d.moved = true;
            onBegin?.();
          }
          e.preventDefault();
          const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          const fine = e.altKey ? step / 10 : step;
          onChange(clamp(Math.round((d.v + dx * step * k) / fine) * fine));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved) {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
            onEnd?.();
          }
        }}
      />
      {unit && <span className="tt-unit">{unit}</span>}
    </span>
  );
}

/** A color: a brand token or a hex value (or a field of type color). */
export function ColorField({
  value,
  onChange,
  tokens,
  values,
  label,
  fields = [],
}: {
  value: string;
  onChange: (v: string) => void;
  tokens: BrandTokens;
  values: Values;
  label: string;
  fields?: string[];
}) {
  const shown = resolveColor(value, tokens, values, '#000000');
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const swatch = isHex(shown) && shown.length === 7 ? shown : shown.slice(0, 7);
  return (
    <span className="tt-color">
      <input type="color" aria-label={`${label} color`} value={isHex(swatch) ? swatch : '#000000'} onChange={(e) => onChange(e.target.value)} />
      <select
        aria-label={`${label} brand color`}
        value={value.startsWith('$') || value.startsWith('{{') ? value : ''}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      >
        <option value="">Custom</option>
        <optgroup label="Event look">
          {TOKEN_KEYS.filter((k) => !k.startsWith('font')).map((k) => (
            <option key={k} value={`$${k}`}>
              {TOKEN_LABELS[k]}
            </option>
          ))}
        </optgroup>
        {fields.length > 0 && (
          <optgroup label="Fields">
            {fields.map((f) => (
              <option key={f} value={`{{${f}}}`}>
                {f}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <input
        className="tt-hex"
        aria-label={`${label} value`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (text !== value ? onChange(text.trim()) : undefined)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="tt-field" title={hint}>
      <span className="tt-field-label">{label}</span>
      <span className="tt-field-body">{children}</span>
    </div>
  );
}

export function Select<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <select className="tt-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="tt-toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Section({ title, children, actions, open: startOpen = true }: { title: string; children: ReactNode; actions?: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className={`tt-section${open ? '' : ' closed'}`}>
      <header>
        <button className="tt-section-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          {title}
        </button>
        {actions}
      </header>
      {open && <div className="tt-section-body">{children}</div>}
    </section>
  );
}
