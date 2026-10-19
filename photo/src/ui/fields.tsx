// Small controls every panel and dialog uses: number fields you can type in
// or scrub, sliders with a number, selects, checkboxes, segmented buttons and
// the dialog frame.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { hex as toHex } from '../core/color';

export function NumberField({
  value,
  onChange,
  onCommit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  digits = 0,
  suffix,
  label,
  width,
  title,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Called when a scrub or typed edit ends. */
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  suffix?: string;
  label?: string;
  width?: number;
  title?: string;
  disabled?: boolean;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? (digits ? v.toFixed(digits) : String(Math.round(v))) : '');
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, digits]);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    const v = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(v)) {
      const c = clamp(v);
      onChange(c);
      onCommit?.(c);
      setText(fmt(c));
    } else setText(fmt(value));
  };
  const scrub = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    const x0 = e.clientX,
      v0 = value;
    let last = v0;
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      last = clamp(Math.round((v0 + ((ev.clientX - x0) / 2) * step * k) / (step * (ev.altKey ? 0.1 : 1))) * step * (ev.altKey ? 0.1 : 1));
      onChange(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit?.(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <span className="lp-opt" title={title}>
      {label && (
        <span className="lp-scrub" onPointerDown={scrub}>
          {label}
        </span>
      )}
      <input
        className="lp-input lp-num"
        style={width ? { width } : undefined}
        value={text}
        disabled={disabled}
        aria-label={label ?? title}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = clamp(value + d);
            onChange(v);
            onCommit?.(v);
            setText(fmt(v));
          }
        }}
      />
      {suffix && <span className="lp-faint">{suffix}</span>}
    </span>
  );
}

/** A slider with its number (percent sliders show 0–100). */
export function Slider({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  digits = 0,
  suffix,
  scale = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  digits?: number;
  suffix?: string;
  /** Shown value = value × scale (e.g. 100 for percents). */
  scale?: number;
}) {
  return (
    <div className="lp-slider">
      <label>{label}</label>
      <NumberField
        value={value * scale}
        min={min * scale}
        max={max * scale}
        step={step * scale}
        digits={digits}
        suffix={suffix}
        onChange={(v) => onChange(v / scale)}
        onCommit={onCommit ? (v) => onCommit(v / scale) : undefined}
        width={52}
      />
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  title,
  width,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label?: string;
  title?: string;
  width?: number;
}) {
  const sel = (
    <select
      className="lp-select"
      value={String(value)}
      aria-label={label ?? title}
      title={title}
      style={width ? { width } : undefined}
      onChange={(e) => {
        const o = options.find(([v]) => String(v) === e.target.value);
        if (o) onChange(o[0]);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {options.map(([v, l]) => (
        <option key={String(v)} value={String(v)}>
          {l}
        </option>
      ))}
    </select>
  );
  if (!label) return sel;
  return (
    <span className="lp-opt">
      <span>{label}</span>
      {sel}
    </span>
  );
}

export function Check({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="lp-check-label" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { v: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span className="lp-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} aria-pressed={value === o.v} title={o.label} aria-label={o.label} onClick={() => onChange(o.v)}>
          {o.icon ?? o.label}
        </button>
      ))}
    </span>
  );
}

export function ColorWell({ color, onClick, title, size = 22 }: { color: readonly number[]; onClick?: () => void; title: string; size?: number }) {
  return (
    <button
      className="lp-swatch"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{ background: toHex(color as [number, number, number]), width: size, height: size }}
    />
  );
}

export function Dialog({
  title,
  onClose,
  children,
  foot,
  width,
  modal = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
  width?: number | string;
  modal?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, button.lp-primary');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div
      className="lp-modal-back"
      style={modal ? undefined : { background: 'transparent', pointerEvents: 'none' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && modal) e.stopPropagation();
      }}
    >
      <div
        ref={ref}
        className="lp-dialog"
        role="dialog"
        aria-modal={modal}
        aria-label={title}
        style={{ width, pointerEvents: 'auto' }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="lp-dialog-head">
          <span>{title}</span>
          <span className="lp-spacer" />
          <button className="lp-icon-btn" aria-label="Close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="lp-dialog-body">{children}</div>
        {foot && <div className="lp-dialog-foot">{foot}</div>}
      </div>
    </div>
  );
}

/** OK / Cancel buttons. */
export function OkCancel({ onOk, onCancel, ok = 'OK', disabled }: { onOk: () => void; onCancel: () => void; ok?: string; disabled?: boolean }) {
  return (
    <>
      <span className="lp-spacer" />
      <button className="lp-btn" onClick={onCancel}>
        Cancel
      </button>
      <button className="lp-btn lp-primary" onClick={onOk} disabled={disabled}>
        {ok}
      </button>
    </>
  );
}
