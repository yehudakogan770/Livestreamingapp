// A button that opens a short menu under it (the view's guides and helpers,
// the workspace). Escape or a click elsewhere closes it; arrows move in it.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function MenuButton({
  label,
  title,
  children,
  align = 'left',
  className = '',
}: {
  label: ReactNode;
  title: string;
  /** The menu's items (get `close` to close it after a choice). */
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
        box.current?.querySelector<HTMLElement>('.tt-menubtn')?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <div className={`tt-menuwrap ${className}`.trim()} ref={box}>
      <button className={`tt-menubtn${open ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)}>
        {label}
        <ChevronDown size={13} className="tt-faint" />
      </button>
      {open && (
        <div className={`tt-menu-pop ${align}`} role="menu" aria-label={title}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A menu item that is on or off. */
export function MenuCheck({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <button role="menuitemcheckbox" aria-checked={checked} className="tt-menu-item" onClick={() => onChange(!checked)}>
      <span className="tt-menu-tick">{checked ? '✓' : ''}</span>
      <span className="tt-menu-label">{children}</span>
      {hint && <kbd className="tt-menu-hint">{hint}</kbd>}
    </button>
  );
}

/** A menu item that does something (or picks one of a set: `chosen`). */
export function MenuItem({
  onClick,
  children,
  hint,
  chosen,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  chosen?: boolean;
  disabled?: boolean;
}) {
  return (
    <button role={chosen === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={chosen} className="tt-menu-item" onClick={onClick} disabled={disabled}>
      <span className="tt-menu-tick">{chosen ? '•' : ''}</span>
      <span className="tt-menu-label">{children}</span>
      {hint && <kbd className="tt-menu-hint">{hint}</kbd>}
    </button>
  );
}

export const MenuSep = () => <div className="tt-menu-sep" role="separator" />;
