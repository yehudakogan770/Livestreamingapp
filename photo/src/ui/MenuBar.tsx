// The menu bar: File, Edit, Image, Layer, Select, Filter, View, Window, Help.

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { MENUS, type MenuEntry } from './menus';
import { command, run, shortcutOf, shortcutLabel } from '../app/commands';
import { app, setCurrent, useApp } from '../app/state';
import { Mark } from './Mark';
import { recentFiles } from '../app/recent';
import { openRecent } from './StartScreen';
import { PANELS, panelShown, togglePanel } from './Dock';

interface Item {
  label: string;
  keys?: string;
  enabled: boolean;
  checked?: boolean;
  run?: () => void;
  sub?: Item[];
  sep?: boolean;
}

function resolve(entries: MenuEntry[]): Item[] {
  const out: Item[] = [];
  for (const e of entries) {
    if (e === '-') {
      if (out.length && !out[out.length - 1]!.sep) out.push({ label: '', enabled: false, sep: true });
      continue;
    }
    if (typeof e === 'string') {
      const c = command(e);
      if (!c) continue;
      out.push({ label: c.label, keys: shortcutOf(e), enabled: c.enabled ? c.enabled() : true, checked: c.checked?.(), run: () => void run(e) });
      continue;
    }
    if ('dynamic' in e) {
      if (e.dynamic === 'recent') {
        const list = recentFiles();
        out.push({ label: 'Open Recent', enabled: list.length > 0, sub: list.map((r) => ({ label: r.name, enabled: true, run: () => void openRecent(r) })) });
      } else if (e.dynamic === 'panels') {
        for (const p of PANELS) out.push({ label: p.label, enabled: true, checked: panelShown(p.id), run: () => togglePanel(p.id) });
      } else if (e.dynamic === 'documents') {
        const st = app.get();
        for (const s of st.sessions) out.push({ label: s.doc.name, enabled: true, checked: s.id === st.current, run: () => setCurrent(s.id) });
      }
      continue;
    }
    const sub = resolve(e.items);
    out.push({ label: e.label, enabled: sub.some((x) => x.enabled && !x.sep), sub });
  }
  while (out.length && out[out.length - 1]!.sep) out.pop();
  return out;
}

function MenuList({ items, x, y, onDone, level = 0 }: { items: Item[]; x: number; y: number; onDone: () => void; level?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const [subPos, setSubPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x,
      ny = y;
    if (r.right > window.innerWidth - 4) nx = level ? x - r.width - 232 : window.innerWidth - r.width - 4;
    if (r.bottom > window.innerHeight - 4) ny = Math.max(4, window.innerHeight - r.height - 4);
    if (nx !== x || ny !== y) setPos({ x: Math.max(4, nx), y: ny });
  }, [x, y, level]);
  const timer = useRef(0);
  return (
    <div ref={ref} className="lp-menu" role="menu" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="lp-menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`lp-menu-item${open === i ? ' lp-open' : ''}`}
            disabled={!it.enabled}
            aria-haspopup={it.sub ? 'menu' : undefined}
            onPointerEnter={(e) => {
              clearTimeout(timer.current);
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              timer.current = window.setTimeout(
                () => {
                  setOpen(it.sub ? i : null);
                  setSubPos({ x: r.right - 2, y: r.top - 5 });
                },
                it.sub ? 60 : 120,
              );
            }}
            onClick={(e) => {
              if (it.sub) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setOpen(i);
                setSubPos({ x: r.right - 2, y: r.top - 5 });
                return;
              }
              onDone();
              it.run?.();
            }}
          >
            <span className="lp-check">{it.checked ? <Check size={13} /> : null}</span>
            <span>{it.label}</span>
            {it.sub ? (
              <span className="lp-keys">
                <ChevronRight size={13} />
              </span>
            ) : it.keys ? (
              <span className="lp-keys">{shortcutLabel(it.keys)}</span>
            ) : null}
          </button>
        ),
      )}
      {open !== null && items[open]?.sub && <MenuList items={items[open].sub} x={subPos.x} y={subPos.y} onDone={onDone} level={level + 1} />}
    </div>
  );
}

export function MenuBar({ right }: { right?: React.ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useApp((s) => s.rev);
  useEffect(() => {
    if (open === null) return;
    const close = () => setOpen(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', close);
    };
  }, [open]);
  const show = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 2 });
    setOpen(i);
  };
  return (
    <div className="lp-menubar" role="menubar">
      <span className="lp-mark" title="Lumora Photo">
        <Mark size={18} />
      </span>
      {MENUS.map((m, i) => (
        <button
          key={m.label}
          className="lp-menu-title"
          aria-expanded={open === i}
          aria-haspopup="menu"
          onPointerDown={(e) => {
            e.stopPropagation();
            if (open === i) setOpen(null);
            else show(i, e.currentTarget);
          }}
          onPointerEnter={(e) => {
            if (open !== null && open !== i) show(i, e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              show(i, e.currentTarget);
            }
          }}
        >
          {m.label}
        </button>
      ))}
      <span className="lp-spacer" />
      {right}
      {open !== null && <MenuList key={open} items={resolve(MENUS[open]!.items)} x={pos.x} y={pos.y} onDone={() => setOpen(null)} />}
    </div>
  );
}

/** A right-click menu from command ids. */
export function ContextMenu({ entries, x, y, onClose }: { entries: MenuEntry[]; x: number; y: number; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);
  return <MenuList items={resolve(entries)} x={x} y={y} onDone={onClose} />;
}
