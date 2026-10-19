// The designer's workspace: panel sizes (dragged), where each panel is docked
// (panels are dragged by their tabs into another group, or above or below
// one, on either side), and the canvas on its own; four ready workspaces
// (Design, Animate, Data, Operator); the layout and the recent titles are
// kept in this browser.

export type PanelId = 'library' | 'project' | 'history' | 'layer' | 'comp' | 'fields' | 'look' | 'data';
/** The panels that start on the left / right (any can be docked on either side). */
export type LeftTab = 'library' | 'project' | 'history';
export type RightTab = 'layer' | 'comp' | 'fields' | 'look' | 'data';
export type WorkspaceName = 'design' | 'animate' | 'data' | 'operator';
export type Side = 'left' | 'right';

export const PANELS: PanelId[] = ['library', 'project', 'history', 'layer', 'comp', 'fields', 'look', 'data'];
export const PANEL_NAMES: Record<PanelId, string> = {
  library: 'Library',
  project: 'Project',
  history: 'History',
  layer: 'Layer',
  comp: 'Composition',
  fields: 'Fields',
  look: 'Look',
  data: 'Data',
};

/** Panels docked together: tabs, the one showing, and its share of the side's height. */
export interface DockGroup {
  tabs: PanelId[];
  active: PanelId;
  /** Share of the side's height (the groups of a side are sized by these weights). */
  size: number;
}

export interface Docks {
  left: DockGroup[];
  right: DockGroup[];
}

export interface Layout {
  workspace: WorkspaceName;
  /** Panel widths and the timeline's height, px. */
  left: number;
  right: number;
  timeline: number;
  /** Where each panel is docked (every panel once). */
  docks: Docks;
  /** Only the canvas (panels and timeline hidden). */
  canvasOnly: boolean;
}

export const WORKSPACE_NAMES: Record<WorkspaceName, string> = { design: 'Design', animate: 'Animate', data: 'Data', operator: 'Operator' };

const g = (tabs: PanelId[], active: PanelId = tabs[0]!, size = 1): DockGroup => ({ tabs, active, size });

/** What each workspace sets (sizes, docked panels). */
export const WORKSPACES: Record<WorkspaceName, Omit<Layout, 'workspace' | 'canvasOnly'>> = {
  design: {
    left: 236,
    right: 320,
    timeline: 300,
    docks: { left: [g(['library', 'project', 'history'])], right: [g(['layer', 'comp', 'fields', 'look', 'data'])] },
  },
  animate: {
    left: 220,
    right: 320,
    timeline: 460,
    docks: { left: [g(['project', 'library'], 'project', 1), g(['history'], 'history', 0.6)], right: [g(['layer', 'comp', 'fields', 'look', 'data'])] },
  },
  data: {
    left: 220,
    right: 400,
    timeline: 220,
    docks: { left: [g(['project', 'library', 'history'], 'project')], right: [g(['data', 'layer', 'comp'], 'data', 1), g(['fields', 'look'], 'fields', 1)] },
  },
  operator: {
    left: 220,
    right: 420,
    timeline: 170,
    docks: { left: [g(['library', 'project', 'history'])], right: [g(['fields', 'data', 'layer', 'comp', 'look'], 'fields')] },
  },
};

export const LIMITS = { left: [160, 480], right: [240, 560], timeline: [120, 900] } as const;

export const clampSize = (k: keyof typeof LIMITS, v: number) => Math.round(Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v)));

const copyDocks = (d: Docks): Docks => ({ left: d.left.map((x) => ({ ...x, tabs: [...x.tabs] })), right: d.right.map((x) => ({ ...x, tabs: [...x.tabs] })) });

export function workspace(name: WorkspaceName): Layout {
  const w = WORKSPACES[name];
  return { workspace: name, ...w, docks: copyDocks(w.docks), canvasOnly: false };
}

/** Every panel docked exactly once, no empty groups, a showing tab in each (anything odd is put right). */
export function normalizeDocks(d: Partial<Docks> | null | undefined, fallback: Docks): Docks {
  const seen = new Set<PanelId>();
  const side = (list: unknown): DockGroup[] =>
    (Array.isArray(list) ? list : [])
      .map((x): DockGroup | null => {
        const o = x as Partial<DockGroup> | null;
        const tabs = (Array.isArray(o?.tabs) ? o!.tabs : []).filter((t): t is PanelId => {
          if (!PANELS.includes(t as PanelId) || seen.has(t as PanelId)) return false;
          seen.add(t as PanelId);
          return true;
        });
        if (!tabs.length) return null;
        const size = Number(o?.size);
        return { tabs, active: tabs.includes(o?.active as PanelId) ? (o!.active as PanelId) : tabs[0]!, size: size > 0.05 && size < 20 ? size : 1 };
      })
      .filter((x): x is DockGroup => !!x)
      .slice(0, MAX_GROUPS);
  const out: Docks = { left: side(d?.left), right: side(d?.right) };
  const missing = PANELS.filter((p) => !seen.has(p));
  if (missing.length) {
    // Panels nowhere (an older layout): where the workspace has them.
    for (const p of missing) {
      const where: Side = fallback.left.some((x) => x.tabs.includes(p)) ? 'left' : 'right';
      const list = out[where];
      if (list.length) list[list.length - 1]!.tabs.push(p);
      else list.push({ tabs: [p], active: p, size: 1 });
    }
  }
  return out;
}

/** The most panel groups stacked on one side. */
export const MAX_GROUPS = 3;

/** Where a panel is docked. */
export function findPanel(d: Docks, id: PanelId): { side: Side; group: number } | null {
  for (const side of ['left', 'right'] as const) {
    const i = d[side].findIndex((x) => x.tabs.includes(id));
    if (i >= 0) return { side, group: i };
  }
  return null;
}

/** Bring a panel to the front of its group. */
export function showPanel(d: Docks, id: PanelId): Docks {
  const at = findPanel(d, id);
  if (!at) return d;
  const cur = d[at.side][at.group]!;
  if (cur.active === id) return d;
  return { ...d, [at.side]: d[at.side].map((x, i) => (i === at.group ? { ...x, active: id } : x)) };
}

/** Where a dragged panel goes: into a group's tabs (at a place), or a new group above or below one. */
export type DockTarget =
  | { kind: 'tabs'; side: Side; group: number; index: number }
  | { kind: 'split'; side: Side; group: number; where: 'before' | 'after' }
  | { kind: 'side'; side: Side };

/** Move a panel to a target (the layout as it was when nothing would change). */
export function movePanel(d: Docks, id: PanelId, to: DockTarget): Docks {
  const from = findPanel(d, id);
  if (!from) return d;
  const next = copyDocks(d);
  const src = next[from.side][from.group]!;
  const srcIndex = src.tabs.indexOf(id);
  // Dropped where it already is.
  if (to.kind === 'tabs' && to.side === from.side && to.group === from.group && (to.index === srcIndex || to.index === srcIndex + 1)) {
    return showPanel(d, id);
  }
  if (to.kind === 'split' && src.tabs.length === 1 && to.side === from.side && (to.group === from.group || (to.where === 'after' && to.group === from.group - 1) || (to.where === 'before' && to.group === from.group + 1)))
    return d;
  if (to.kind === 'split' && next[to.side].length >= MAX_GROUPS && !(to.side === from.side && src.tabs.length === 1)) return d;
  // Take it out (a group left empty goes; the targets after it on that side move up).
  src.tabs.splice(srcIndex, 1);
  let group = to.kind === 'side' ? -1 : to.group;
  let index = to.kind === 'tabs' ? to.index : 0;
  if (to.kind === 'tabs' && to.side === from.side && to.group === from.group && index > srcIndex) index--;
  if (!src.tabs.length) {
    next[from.side].splice(from.group, 1);
    if (to.side === from.side && group > from.group) group--;
  } else if (src.active === id) src.active = src.tabs[Math.min(srcIndex, src.tabs.length - 1)]!;
  if (to.kind === 'tabs') {
    const target = next[to.side][group];
    if (!target) return d;
    target.tabs.splice(Math.max(0, Math.min(index, target.tabs.length)), 0, id);
    target.active = id;
  } else if (to.kind === 'split') {
    const at = to.where === 'before' ? group : group + 1;
    next[to.side].splice(Math.max(0, Math.min(at, next[to.side].length)), 0, { tabs: [id], active: id, size: 1 });
  } else next[to.side].push({ tabs: [id], active: id, size: 1 });
  return next;
}

/** Share the height between two neighboring groups (weights; each keeps at least a little). */
export function resizeGroups(d: Docks, side: Side, i: number, share: number): Docks {
  const list = d[side];
  const a = list[i];
  const b = list[i + 1];
  if (!a || !b) return d;
  const total = a.size + b.size;
  const s = Math.min(0.85, Math.max(0.15, share));
  return { ...d, [side]: list.map((x, j) => (j === i ? { ...x, size: total * s } : j === i + 1 ? { ...x, size: total * (1 - s) } : x)) };
}

const KEY = 'lumora-titler-layout';

export function loadLayout(): Layout {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Partial<Layout> & { leftTab?: string; rightTab?: string }) | null;
    if (o && o.workspace && o.workspace in WORKSPACES) {
      const base = workspace(o.workspace);
      let docks = normalizeDocks(o.docks ?? base.docks, base.docks);
      // An older layout: only which tab was open on each side.
      if (!o.docks) {
        if (PANELS.includes(o.leftTab as PanelId)) docks = showPanel(docks, o.leftTab as PanelId);
        if (PANELS.includes(o.rightTab as PanelId)) docks = showPanel(docks, o.rightTab as PanelId);
      }
      return {
        ...base,
        left: clampSize('left', Number(o.left) || base.left),
        right: clampSize('right', Number(o.right) || base.right),
        timeline: clampSize('timeline', Number(o.timeline) || base.timeline),
        docks,
        canvasOnly: false,
      };
    }
  } catch {
    // Nothing kept, or not readable.
  }
  return workspace('design');
}

export function saveLayout(l: Layout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...l, canvasOnly: false }));
  } catch {
    // Not kept (private window).
  }
}

// ---- recent titles ----

export interface Recent {
  /** A library id or file path the host can read again. */
  id: string;
  name: string;
  at: number;
}

const RECENT_KEY = 'lumora-titler-recent';

export function recentTitles(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'string' && typeof r.name === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

/** Put a title at the top of the recent list (10 kept). */
export function rememberTitle(id: string, name: string, now = Date.now()): Recent[] {
  const list = [{ id, name, at: now }, ...recentTitles().filter((r) => r.id !== id)].slice(0, 10);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Not kept.
  }
  return list;
}

export function forgetTitle(id: string): Recent[] {
  const list = recentTitles().filter((r) => r.id !== id);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Not kept.
  }
  return list;
}
