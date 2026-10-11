// Commands: everything the menus, shortcuts and actions can do, by id. The
// shortcuts follow Photoshop's defaults and can be changed (Edit ▸ Keyboard
// Shortcuts); actions record the commands run while recording.

export interface Command {
  id: string;
  label: string;
  /** Default shortcut, e.g. "Ctrl+Shift+N" (Ctrl is ⌘ on a Mac). */
  keys?: string;
  run: (arg?: unknown) => void | Promise<void>;
  enabled?: () => boolean;
  checked?: () => boolean;
  /** Can be recorded in an action (needs no pointer input). */
  record?: boolean;
}

const registry = new Map<string, Command>();
const CUSTOM_KEY = 'lumora.photo.shortcuts';

let custom: Record<string, string> = {};
try {
  custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '{}') as Record<string, string>;
} catch {
  custom = {};
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function register(list: Command[]): void {
  for (const c of list) registry.set(c.id, c);
}

export function command(id: string): Command | undefined {
  return registry.get(id);
}

export function allCommands(): Command[] {
  return [...registry.values()];
}

export function shortcutOf(id: string): string {
  if (id in custom) return custom[id]!;
  return registry.get(id)?.keys ?? '';
}

export function setShortcut(id: string, keys: string): void {
  custom[id] = keys;
  // One shortcut does one thing: take it from any other command.
  for (const c of registry.values()) if (c.id !== id && shortcutOf(c.id) === keys && keys) custom[c.id] = '';
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
  } catch {
    /* kept for this visit */
  }
}

export function resetShortcuts(): void {
  custom = {};
  try {
    localStorage.removeItem(CUSTOM_KEY);
  } catch {
    /* nothing kept */
  }
}

/** How a shortcut reads on this computer. */
export function shortcutLabel(keys: string): string {
  if (!keys) return '';
  if (!isMac) return keys;
  return keys.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧');
}

/** The shortcut string for a key event. */
export function eventKeys(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key;
  if (k === ' ') k = 'Space';
  else if (k.length === 1) k = k.toUpperCase();
  // Shifted symbols: use the base key so "Ctrl+Shift+=" matches on every layout we can.
  if (e.code === 'Equal') k = '=';
  else if (e.code === 'Minus') k = '-';
  else if (e.code === 'BracketLeft') k = '[';
  else if (e.code === 'BracketRight') k = ']';
  else if (e.code === 'Backslash') k = '\\';
  else if (e.code === 'Semicolon') k = ';';
  else if (e.code === 'Quote') k = "'";
  else if (e.code === 'Comma') k = ',';
  else if (e.code === 'Period') k = '.';
  else if (e.code === 'Slash') k = '/';
  else if (e.code === 'Backquote') k = '`';
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return parts.join('+');
  parts.push(k);
  return parts.join('+');
}

// ---- actions (recorded command lists) ----

export interface ActionStep {
  id: string;
  arg?: unknown;
  label: string;
  enabled: boolean;
}

export interface Action {
  name: string;
  steps: ActionStep[];
}

let recording: Action | null = null;
let recordListener: (() => void) | null = null;

export function startRecording(a: Action, onChange: () => void): void {
  recording = a;
  recordListener = onChange;
}

export function stopRecording(): void {
  recording = null;
  recordListener = null;
}

export const isRecording = () => recording !== null;

/** Run a command (recording it when an action is being recorded). */
export async function run(id: string, arg?: unknown): Promise<void> {
  const c = registry.get(id);
  if (!c) return;
  if (c.enabled && !c.enabled()) return;
  if (recording && c.record) {
    recording.steps.push({ id, arg: arg === undefined ? undefined : structuredClone(arg), label: c.label, enabled: true });
    recordListener?.();
  }
  await c.run(arg);
}

/** Run a key event's command; true when one ran. */
export function handleShortcut(e: KeyboardEvent): boolean {
  const k = eventKeys(e);
  if (!k) return false;
  for (const c of registry.values()) {
    if (shortcutOf(c.id) !== k) continue;
    if (c.enabled && !c.enabled()) return true;
    e.preventDefault();
    void run(c.id);
    return true;
  }
  return false;
}
