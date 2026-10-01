// The Jewish event tools (12 Pesukim, Tanach & Tehillim, Hebrew date and
// zmanim) are hidden until switched on in Settings, so Lumora looks like any
// event app. Remembered on this computer. An event that already uses one of
// them shows them anyway, so nothing in it is ever out of reach.

import type { Show } from './types/Show';

const KEY = 'lumora.jewishTools';

/** The kinds of input that belong to the Jewish event tools. */
export const JEWISH_KINDS: readonly string[] = ['pesukim', 'scripture', 'zmanim'];

/** Whether they were switched on in Settings (off at first). */
export function loadJewishTools(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveJewishTools(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered, but still applied until Lumora closes.
  }
}

/** Whether to show them: switched on, or this event already uses one. */
export function jewishToolsOn(show?: Pick<Show, 'sources'> | null, on = loadJewishTools()): boolean {
  return on || !!show?.sources.some((s) => JEWISH_KINDS.includes(s.kind.type));
}
