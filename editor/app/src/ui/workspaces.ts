// Saved workspaces: which page is showing and how big the panels are, kept
// by name on this computer (with a few ready-made ones).
import type { Page, Ui, UiState } from './state';

export interface Workspace {
  name: string;
  page: Page;
  left: number;
  right: number;
  bottom: number;
}

export const BUILT_IN_WORKSPACES: Workspace[] = [
  { name: 'Editing', page: 'edit', left: 330, right: 330, bottom: 330 },
  { name: 'Big viewer', page: 'edit', left: 260, right: 300, bottom: 240 },
  { name: 'Big timeline', page: 'edit', left: 300, right: 300, bottom: 520 },
  { name: 'Color', page: 'color', left: 330, right: 330, bottom: 360 },
  { name: 'Audio', page: 'audio', left: 330, right: 330, bottom: 420 },
];

const KEY = 'lumora-edit-workspaces';

const valid = (w: unknown): w is Workspace =>
  !!w &&
  typeof w === 'object' &&
  typeof (w as Workspace).name === 'string' &&
  ['edit', 'color', 'audio'].includes((w as Workspace).page) &&
  [(w as Workspace).left, (w as Workspace).right, (w as Workspace).bottom].every((n) => typeof n === 'number' && Number.isFinite(n));

export function savedWorkspaces(): Workspace[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(valid) : [];
  } catch {
    return [];
  }
}

function keep(list: Workspace[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not kept: fine.
  }
}

/** The layout now, kept under a name (replacing one of the same name). */
export function saveWorkspace(name: string, s: Pick<UiState, 'page' | 'left' | 'right' | 'bottom'>): Workspace[] {
  const w: Workspace = { name: name.trim() || 'My workspace', page: s.page, left: s.left, right: s.right, bottom: s.bottom };
  const list = [...savedWorkspaces().filter((x) => x.name.toLowerCase() !== w.name.toLowerCase()), w];
  keep(list);
  return list;
}

export function deleteWorkspace(name: string): Workspace[] {
  const list = savedWorkspaces().filter((x) => x.name !== name);
  keep(list);
  return list;
}

/** Panel sizes that fit the window. */
export function fitted(w: Workspace, width: number, height: number): Workspace {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));
  return { ...w, left: clamp(w.left, 220, 560), right: clamp(w.right, 260, width - 420), bottom: clamp(w.bottom, 180, height - 260) };
}

export function applyWorkspace(ui: Ui, w: Workspace) {
  const f = typeof window === 'undefined' ? w : fitted(w, window.innerWidth, window.innerHeight);
  ui.set({ page: f.page, left: f.left, right: f.right, bottom: f.bottom });
  ui.note(`Workspace: ${w.name}`);
}
