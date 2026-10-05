import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isAnim, keyTimes, removeKey, setKey, setValue, toggleAnim, valueAt } from '../model/anim';
import type { Param } from '../model/types';

const fmt = (v: number, decimals: number) =>
  Number.isFinite(v)
    ? v
        .toFixed(decimals)
        .replace(/\.0+$/, '')
        .replace(/(\.\d*?)0+$/, '$1')
    : '0';

/** A number you drag left and right to change (or click to type), as in pro editors. */
export function Scrub({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit = '',
  decimals,
  label,
  width,
}: {
  value: number;
  onChange: (v: number, final: boolean) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  decimals?: number;
  label?: string;
  width?: number;
}) {
  const [typingText, setTyping] = useState<string | null>(null);
  const d = decimals ?? (step < 0.1 ? 2 : step < 1 ? 1 : 0);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  if (typingText !== null)
    return (
      <input
        className="scrub scrub--typing"
        autoFocus
        aria-label={label}
        value={typingText}
        style={width ? { width } : undefined}
        onChange={(e) => setTyping(e.target.value)}
        onBlur={() => {
          const v = Number(typingText);
          if (Number.isFinite(v)) onChange(clamp(v), true);
          setTyping(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setTyping(null);
          e.stopPropagation();
        }}
      />
    );
  return (
    <button
      type="button"
      className="scrub"
      aria-label={label}
      title="Drag to change, click to type (Shift: faster, Ctrl: finer)"
      style={width ? { width } : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const x0 = e.clientX;
        const start = value;
        let moved = false;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - x0;
          if (Math.abs(dx) > 2) moved = true;
          if (!moved) return;
          const k = ev.shiftKey ? 10 : ev.ctrlKey ? 0.1 : 1;
          onChange(clamp(start + dx * step * k), false);
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          if (!moved) setTyping(fmt(value, d));
          else onChange(clamp(value), true);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
    >
      {fmt(value, d)}
      {unit && <span className="scrub__unit">{unit}</span>}
    </button>
  );
}

/**
 * One setting that can change over the clip: the stopwatch turns keyframes
 * on; the arrows jump between them; the diamond adds or takes one away.
 */
export function ParamRow({
  label,
  param,
  local,
  def,
  min,
  max,
  step,
  unit,
  onChange,
  onSeek,
  clipStart,
  slider = true,
}: {
  label: string;
  param: Param | undefined;
  /** Frames into the clip at the playhead. */
  local: number;
  def: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (p: Param, final: boolean) => void;
  onSeek: (frame: number) => void;
  clipStart: number;
  slider?: boolean;
}) {
  const v = valueAt(param, local, def);
  const animated = isAnim(param);
  const keys = keyTimes(param);
  const onKey = keys.includes(local);
  const prev = [...keys].reverse().find((k) => k < local);
  const next = keys.find((k) => k > local);
  const set = (x: number, final: boolean) => onChange(animated ? setValue(param, local, x) : x, final);
  return (
    <div className={`prow${animated ? ' is-anim' : ''}`}>
      <button
        type="button"
        className={`prow__watch${animated ? ' is-on' : ''}`}
        title={animated ? 'Turn keyframes off (keeps the value here)' : 'Turn keyframes on (the value can change over the clip)'}
        aria-label={`Keyframes for ${label}`}
        onClick={() => onChange(toggleAnim(param, local, def), true)}
      >
        ◷
      </button>
      <span className="prow__label" title={label}>
        {label}
      </span>
      {slider && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          aria-label={label}
          onChange={(e) => set(Number(e.target.value), false)}
          onPointerUp={() => set(v, true)}
        />
      )}
      <Scrub value={v} min={min} max={max} step={step} unit={unit} label={label} onChange={set} />
      <span className="prow__keys">
        {animated && (
          <>
            <button type="button" disabled={prev === undefined} aria-label="Previous keyframe" onClick={() => prev !== undefined && onSeek(clipStart + prev)}>
              ◂
            </button>
            <button
              type="button"
              className={onKey ? 'is-on' : ''}
              aria-label={onKey ? 'Remove keyframe' : 'Add keyframe'}
              title={onKey ? 'Remove this keyframe' : 'Add a keyframe here'}
              onClick={() => onChange(onKey ? removeKey(param as Param, local) : setKey(param, local, v), true)}
            >
              ◆
            </button>
            <button type="button" disabled={next === undefined} aria-label="Next keyframe" onClick={() => next !== undefined && onSeek(clipStart + next)}>
              ▸
            </button>
          </>
        )}
        <button type="button" className="prow__reset" aria-label={`Reset ${label}`} title="Back to the start value" onClick={() => onChange(def, true)}>
          ↺
        </button>
      </span>
    </div>
  );
}

export function Choice<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map(([v, name]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? 'is-on' : ''} onClick={() => onChange(v)}>
          {name}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal__card${wide ? ' modal__card--wide' : ''}`}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  keys?: string;
  run?: () => void;
  disabled?: boolean;
  checked?: boolean;
  items?: MenuItem[];
}
export type MenuEntry = MenuItem | 'sep';

/** A list of commands that opens at a place (a menu, or a right-click). */
export function PopMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !document.querySelector('.pop')?.parentElement?.contains(e.target)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => window.addEventListener('pointerdown', close), 0);
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return createPortal(
    <div className="pops">
      <div className="pop" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
        {items.map((it, i) =>
          it === 'sep' ? (
            <hr key={i} />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className={sub?.i === i ? 'is-open' : ''}
              onPointerEnter={(e) => {
                if (it.items) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSub({ i, x: r.right, y: r.top });
                } else setSub(null);
              }}
              onClick={(e) => {
                if (it.items) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSub({ i, x: r.right, y: r.top });
                  return;
                }
                onClose();
                it.run?.();
              }}
            >
              <span className="pop__check">{it.checked ? '✓' : ''}</span>
              <span className="pop__label">{it.label}</span>
              <span className="pop__keys">{it.items ? '▸' : (it.keys ?? '')}</span>
            </button>
          ),
        )}
      </div>
      {sub &&
        (() => {
          const it = items[sub.i];
          return it && it !== 'sep' && it.items ? <SubMenu x={sub.x} y={sub.y} items={it.items} onClose={onClose} /> : null;
        })()}
    </div>,
    document.body,
  );
}

function SubMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: x + r.width > window.innerWidth ? x - r.width - 200 : x, y: Math.min(y, window.innerHeight - r.height - 4) });
  }, [x, y]);
  return (
    <div className="pop" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.run?.();
            }}
          >
            <span className="pop__check">{it.checked ? '✓' : ''}</span>
            <span className="pop__label">{it.label}</span>
            <span className="pop__keys">{it.keys ?? ''}</span>
          </button>
        ),
      )}
    </div>
  );
}

/** A color picker that fits the dark panels. */
export function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="colorfield" title={label}>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} aria-label={label} onChange={(e) => onChange(e.target.value)} />
      <span>{value.toUpperCase()}</span>
    </label>
  );
}

/** A panel section that folds away. */
export function Section({ title, children, actions, open: startOpen = true }: { title: ReactNode; children: ReactNode; actions?: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className={`sect${open ? '' : ' is-shut'}`}>
      <header className="sect__head">
        <button type="button" className="sect__fold" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="sect__arrow">{open ? '▾' : '▸'}</span>
          {title}
        </button>
        {actions && <span className="sect__actions">{actions}</span>}
      </header>
      {open && <div className="sect__body">{children}</div>}
    </section>
  );
}
