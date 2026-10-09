// The designer's workspace: panel sizes (dragged), which tabs are open, and
// the canvas on its own; four ready workspaces (Design, Animate, Data,
// Operator); the layout and the recent titles are kept in this browser.

export type LeftTab = 'library' | 'project' | 'history';
export type RightTab = 'layer' | 'comp' | 'fields' | 'look' | 'data';
export type WorkspaceName = 'design' | 'animate' | 'data' | 'operator';

export interface Layout {
  workspace: WorkspaceName;
  /** Panel widths and the timeline's height, px. */
  left: number;
  right: number;
  timeline: number;
  leftTab: LeftTab;
  rightTab: RightTab;
  /** Only the canvas (panels and timeline hidden). */
  canvasOnly: boolean;
}

export const WORKSPACE_NAMES: Record<WorkspaceName, string> = { design: 'Design', animate: 'Animate', data: 'Data', operator: 'Operator' };

/** What each workspace sets (sizes, tabs). */
export const WORKSPACES: Record<WorkspaceName, Omit<Layout, 'workspace' | 'canvasOnly'>> = {
  design: { left: 236, right: 320, timeline: 300, leftTab: 'library', rightTab: 'layer' },
  animate: { left: 200, right: 300, timeline: 460, leftTab: 'project', rightTab: 'layer' },
  data: { left: 220, right: 400, timeline: 220, leftTab: 'project', rightTab: 'data' },
  operator: { left: 200, right: 420, timeline: 170, leftTab: 'library', rightTab: 'fields' },
};

export const LIMITS = { left: [160, 480], right: [240, 560], timeline: [120, 900] } as const;

export const clampSize = (k: keyof typeof LIMITS, v: number) => Math.round(Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v)));

export function workspace(name: WorkspaceName): Layout {
  return { workspace: name, ...WORKSPACES[name], canvasOnly: false };
}

const KEY = 'lumora-titler-layout';

export function loadLayout(): Layout {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Layout> | null;
    if (o && o.workspace && o.workspace in WORKSPACES) {
      const base = workspace(o.workspace);
      return {
        ...base,
        left: clampSize('left', Number(o.left) || base.left),
        right: clampSize('right', Number(o.right) || base.right),
        timeline: clampSize('timeline', Number(o.timeline) || base.timeline),
        leftTab: (['library', 'project', 'history'] as LeftTab[]).includes(o.leftTab as LeftTab) ? (o.leftTab as LeftTab) : base.leftTab,
        rightTab: (['layer', 'comp', 'fields', 'look', 'data'] as RightTab[]).includes(o.rightTab as RightTab) ? (o.rightTab as RightTab) : base.rightTab,
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
