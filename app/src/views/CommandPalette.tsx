import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MenuItem } from '../components/TitleBar';
import { screenInputs } from '../engine/screenInputs';
import type { Action } from '../engine/types/Action';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import './CommandPalette.css';

export interface PaletteEntry {
  id: string;
  /** What it does, in words. */
  label: string;
  /** Where it lives (a menu's name), shown on the right. */
  group: string;
  run: () => void;
}

/** Every menu item, as entries. */
export function menuEntries(menus: Record<string, MenuItem[]>): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const [group, items] of Object.entries(menus))
    items.forEach((it, i) => {
      if (it && !it.disabled) out.push({ id: `menu:${group}:${i}`, label: it.label.replace(/^● /, ''), group, run: it.onClick });
    });
  return out;
}

/** The show's own things: its inputs, presets, macros and overlays. */
export function showEntries(show: Show, screen: ScreenId, act: (a: Action) => void): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  const sc = screen === 'monitor' ? 'live' : screen;
  const where = sc === 'live' ? 'Live Screen' : 'Back Screen';
  for (const s of screenInputs(show, sc)) {
    if (s.kind.type === 'microphone') continue;
    out.push({ id: `next:${s.id}`, label: `Line up “${s.name}” in Next`, group: where, run: () => act({ type: 'setPreview', screen: sc, sourceId: s.id }) });
  }
  const p = show.screens[sc].preview;
  if (p !== null && p !== show.screens[sc].program) {
    const name = show.sources.find((s) => s.id === p)?.name ?? 'Next';
    out.push({ id: 'take', label: `TAKE “${name}”`, group: where, run: () => act({ type: 'take', screen: sc }) });
  }
  for (const pr of show.presets)
    out.push({ id: `preset:${pr.id}`, label: `Preset: ${pr.name}`, group: 'Presets', run: () => act({ type: 'pickPreset', id: pr.id }) });
  for (const m of show.macros)
    out.push({ id: `macro:${m.id}`, label: `Run macro: ${m.name}`, group: 'Macros', run: () => act({ type: 'runMacro', id: m.id }) });
  show.overlays.forEach((o, ch) => {
    if (!o.sourceId) return;
    const name = show.sources.find((s) => s.id === o.sourceId)?.name ?? `Overlay ${ch + 1}`;
    out.push({
      id: `overlay:${ch}`,
      label: `${o.on ? 'Take off' : 'Put on'} overlay ${ch + 1}: ${name}`,
      group: 'Overlays',
      run: () => act({ type: 'setOverlayOn', channel: ch, value: !o.on }),
    });
  });
  return out;
}

/** The entries that match every word typed, those starting with it first. */
export function findEntries(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...entries];
  const hay = (e: PaletteEntry) => `${e.label} ${e.group}`.toLowerCase();
  const hits = entries.filter((e) => words.every((w) => hay(e).includes(w)));
  const first = words[0]!;
  const rank = (e: PaletteEntry) => {
    const l = e.label.toLowerCase();
    return l.startsWith(first) ? 0 : l.split(/[\s“:]+/).some((w) => w.startsWith(first)) ? 1 : 2;
  };
  return hits
    .map((e, i) => ({ e, i, r: rank(e) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e);
}

/** Most entries listed at once. */
const SHOWN = 50;

/**
 * Find anything Lumora can do by typing (Ctrl + K): every menu command, and
 * this show's inputs, presets, macros and overlays. Keyboard only: type,
 * ↑ ↓ to choose, Enter to run, Esc to close.
 */
export function CommandPalette({ entries, onClose }: { entries: PaletteEntry[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const found = useMemo(() => findEntries(entries, query).slice(0, SHOWN), [entries, query]);
  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [sel]);
  const run = (e: PaletteEntry | undefined) => {
    if (!e) return;
    onClose();
    e.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setSel((s) => Math.min(found.length - 1, s + 1));
    else if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1));
    else if (e.key === 'Enter') run(found[sel]);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const active = found[sel] ? `cmdp-${sel}` : undefined;
  return (
    <div className="modal cmdp" role="dialog" aria-modal="true" aria-label="Find a command" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box cmdp__box">
        <div className="cmdp__find">
          <Search aria-hidden="true" />
          <input
            className="cmdp__input"
            autoFocus
            value={query}
            placeholder="Type what you want to do…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdp-list"
            aria-activedescendant={active}
            aria-label="Find a command"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="cmdp-list" ref={list} className="cmdp__list" role="listbox" aria-label="Commands">
          {found.map((e, i) => (
            <li
              key={e.id}
              id={`cmdp-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === sel}
              className={`cmdp__item${i === sel ? ' is-sel' : ''}`}
              onPointerMove={() => setSel(i)}
              onClick={() => run(e)}
            >
              <span className="cmdp__label">{e.label}</span>
              <span className="cmdp__group">{e.group}</span>
            </li>
          ))}
          {found.length === 0 && <li className="cmdp__none">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
