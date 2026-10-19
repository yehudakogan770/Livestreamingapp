// The dock on the right: panels in tabbed groups stacked top to bottom.
// Tabs can be dragged to another group (or out to make a new one), groups
// resized and collapsed; Window lists every panel. The layout is remembered.

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { LayersPanel } from './panels/LayersPanel';
import { ChannelsPanel } from './panels/ChannelsPanel';
import { PathsPanel } from './panels/PathsPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { AdjustmentsPanel } from './panels/AdjustmentsPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { ColorPanel, SwatchesPanel } from './panels/ColorPanel';
import { BrushesPanel } from './panels/BrushesPanel';
import { CharacterPanel, ParagraphPanel } from './panels/TypePanels';
import { NavigatorPanel, InfoPanel, HistogramPanel } from './panels/ViewPanels';
import { ActionsPanel } from './panels/ActionsPanel';
import { CompsPanel } from './panels/CompsPanel';

export interface PanelDef {
  id: string;
  label: string;
  C: ComponentType;
}

export const PANELS: PanelDef[] = [
  { id: 'layers', label: 'Layers', C: LayersPanel },
  { id: 'channels', label: 'Channels', C: ChannelsPanel },
  { id: 'paths', label: 'Paths', C: PathsPanel },
  { id: 'properties', label: 'Properties', C: PropertiesPanel },
  { id: 'adjustments', label: 'Adjustments', C: AdjustmentsPanel },
  { id: 'history', label: 'History', C: HistoryPanel },
  { id: 'color', label: 'Color', C: ColorPanel },
  { id: 'swatches', label: 'Swatches', C: SwatchesPanel },
  { id: 'brushes', label: 'Brushes', C: BrushesPanel },
  { id: 'character', label: 'Character', C: CharacterPanel },
  { id: 'paragraph', label: 'Paragraph', C: ParagraphPanel },
  { id: 'navigator', label: 'Navigator', C: NavigatorPanel },
  { id: 'info', label: 'Info', C: InfoPanel },
  { id: 'histogram', label: 'Histogram', C: HistogramPanel },
  { id: 'actions', label: 'Actions', C: ActionsPanel },
  { id: 'comps', label: 'Layer Comps', C: CompsPanel },
];

interface Group {
  tabs: string[];
  active: string;
  /** Relative height. */
  size: number;
  collapsed: boolean;
}

interface Layout {
  width: number;
  groups: Group[];
}

const KEY = 'lumora.photo.dock2';

const ESSENTIALS = (): Layout => ({
  width: 300,
  groups: [
    { tabs: ['color', 'swatches', 'navigator', 'histogram', 'info'], active: 'color', size: 1.15, collapsed: false },
    {
      tabs: ['properties', 'adjustments', 'history', 'brushes', 'character', 'paragraph', 'actions', 'comps'],
      active: 'properties',
      size: 1,
      collapsed: false,
    },
    { tabs: ['layers', 'channels', 'paths'], active: 'layers', size: 1.35, collapsed: false },
  ],
});

function load(): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const l = JSON.parse(raw) as Layout;
      const known = new Set(PANELS.map((p) => p.id));
      l.groups = l.groups.map((g) => ({ ...g, tabs: g.tabs.filter((t) => known.has(t)) })).filter((g) => g.tabs.length);
      for (const g of l.groups) if (!g.tabs.includes(g.active)) g.active = g.tabs[0]!;
      if (l.groups.length) return l;
    }
  } catch {
    /* use the default */
  }
  return ESSENTIALS();
}

let layout = load();
const listeners = new Set<() => void>();
function setLayout(l: Layout): void {
  layout = l;
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* kept for this visit */
  }
  for (const f of listeners) f();
}

export const panelShown = (id: string) => layout.groups.some((g) => g.tabs.includes(id));

/** Window ▸ a panel: show it (in front) or hide it if it is in front already. */
export function togglePanel(id: string): void {
  const g = layout.groups.find((x) => x.tabs.includes(id));
  if (g && g.active === id && !g.collapsed) {
    const tabs = g.tabs.filter((t) => t !== id);
    setLayout({ ...layout, groups: layout.groups.map((x) => (x === g ? { ...x, tabs, active: tabs[0] ?? '' } : x)).filter((x) => x.tabs.length) });
    return;
  }
  showPanel(id);
}

export function showPanel(id: string): void {
  const g = layout.groups.find((x) => x.tabs.includes(id));
  if (g) {
    setLayout({ ...layout, groups: layout.groups.map((x) => (x === g ? { ...x, active: id, collapsed: false } : x)) });
    return;
  }
  const groups = [...layout.groups];
  const target = groups[Math.min(1, groups.length - 1)];
  if (!target) groups.push({ tabs: [id], active: id, size: 1, collapsed: false });
  else groups[groups.indexOf(target)] = { ...target, tabs: [...target.tabs, id], active: id, collapsed: false };
  setLayout({ ...layout, groups });
}

export function Dock() {
  const [, setTick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [dragTab, setDragTab] = useState<string | null>(null);
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    listeners.add(f);
    const open = (e: Event) => showPanel((e as CustomEvent<string>).detail);
    const reset = () => setLayout(ESSENTIALS());
    window.addEventListener('lp-open-panel', open);
    window.addEventListener('lp-reset-layout', reset);
    return () => {
      listeners.delete(f);
      window.removeEventListener('lp-open-panel', open);
      window.removeEventListener('lp-reset-layout', reset);
    };
  }, []);

  const moveTab = (tab: string, toGroup: number | 'new') => {
    let groups = layout.groups.map((g) => ({ ...g, tabs: g.tabs.filter((t) => t !== tab) }));
    if (toGroup === 'new') groups.push({ tabs: [tab], active: tab, size: 1, collapsed: false });
    else groups[toGroup] = { ...groups[toGroup]!, tabs: [...groups[toGroup]!.tabs, tab], active: tab, collapsed: false };
    groups = groups.filter((g) => g.tabs.length).map((g) => (g.tabs.includes(g.active) ? g : { ...g, active: g.tabs[0]! }));
    setLayout({ ...layout, groups });
  };

  const resizeGroups = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const kids = [...el.querySelectorAll<HTMLElement>(':scope > .lp-group')];
    const a = kids[i],
      b = kids[i + 1];
    if (!a || !b) return;
    const ha = a.getBoundingClientRect().height,
      hb = b.getBoundingClientRect().height;
    const ga = layout.groups[i]!,
      gb = layout.groups[i + 1]!;
    const total = ga.size + gb.size;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const d = ev.clientY - y0;
      const na = Math.max(60, ha + d),
        nb = Math.max(60, hb - d);
      const k = total / (na + nb);
      setLayout({ ...layout, groups: layout.groups.map((g, j) => (j === i ? { ...g, size: na * k } : j === i + 1 ? { ...g, size: nb * k } : g)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const resizeWidth = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX,
      w0 = layout.width;
    const move = (ev: PointerEvent) => setLayout({ ...layout, width: Math.max(220, Math.min(520, w0 - (ev.clientX - x0))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      <div className="lp-dock-resize" onPointerDown={resizeWidth} role="separator" aria-orientation="vertical" aria-label="Resize panels" />
      <div
        ref={ref}
        className="lp-dock"
        style={{ ['--dock-w' as string]: `${layout.width}px` }}
        onDragOver={(e) => {
          if (dragTab) e.preventDefault();
        }}
        onDrop={(e) => {
          if (dragTab && e.target === e.currentTarget) moveTab(dragTab, 'new');
          setDragTab(null);
        }}
      >
        {layout.groups.map((g, gi) => {
          const P = PANELS.find((p) => p.id === g.active);
          return (
            <div key={gi} style={{ display: 'contents' }}>
              {gi > 0 && <div className="lp-group-split" onPointerDown={resizeGroups(gi - 1)} role="separator" aria-label="Resize panel group" />}
              <section
                className={`lp-group${g.collapsed ? ' lp-collapsed' : ''}`}
                style={{ flex: `${g.size} 1 0` }}
                aria-label={`${P?.label ?? ''} panel group`}
              >
                <div
                  className="lp-group-tabs"
                  role="tablist"
                  onDragOver={(e) => {
                    if (dragTab) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    if (dragTab) moveTab(dragTab, gi);
                    setDragTab(null);
                  }}
                  onDoubleClick={(e) => {
                    if (e.target === e.currentTarget)
                      setLayout({ ...layout, groups: layout.groups.map((x, j) => (j === gi ? { ...x, collapsed: !x.collapsed } : x)) });
                  }}
                >
                  {g.tabs.map((t) => (
                    <button
                      key={t}
                      role="tab"
                      className="lp-group-tab"
                      aria-selected={t === g.active}
                      draggable
                      onDragStart={(e) => {
                        setDragTab(t);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', t);
                      }}
                      onDragEnd={() => setDragTab(null)}
                      onClick={() =>
                        setLayout({
                          ...layout,
                          groups: layout.groups.map((x, j) => (j === gi ? { ...x, active: t, collapsed: x.active === t ? !x.collapsed : false } : x)),
                        })
                      }
                    >
                      {PANELS.find((p) => p.id === t)?.label}
                    </button>
                  ))}
                  <span className="lp-spacer" />
                  <button
                    className="lp-icon-btn"
                    aria-label={g.collapsed ? 'Expand' : 'Collapse'}
                    title={g.collapsed ? 'Expand' : 'Collapse'}
                    onClick={() => setLayout({ ...layout, groups: layout.groups.map((x, j) => (j === gi ? { ...x, collapsed: !x.collapsed } : x)) })}
                  >
                    {g.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button className="lp-icon-btn" aria-label={`Close ${P?.label}`} title="Close panel" onClick={() => togglePanel(g.active)}>
                    <X size={14} />
                  </button>
                </div>
                {!g.collapsed && P && (
                  <div className="lp-group-body" role="tabpanel">
                    <P.C />
                  </div>
                )}
              </section>
            </div>
          );
        })}
      </div>
    </>
  );
}
