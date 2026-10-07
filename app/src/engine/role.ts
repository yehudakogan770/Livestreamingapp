import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ScreenId } from './types/ScreenId';
import { isInsideLumora } from './client';

const SCREENS: ScreenId[] = ['live', 'back', 'monitor'];

/**
 * Which screen this window outputs, or null for the control window.
 * Inside Lumora the window label says it (`output-live`); in a browser,
 * `?output=live` does the same so outputs can be tried without the app.
 */
/** This window is the multiview. */
export function isMultiview(): boolean {
  return isInsideLumora() ? getCurrentWindow().label === 'output-multiview' : new URLSearchParams(window.location.search).get('output') === 'multiview';
}

/** The unified engine's hidden graphics renderer for a screen (`overlay-live`, `overlay-back`), or null. */
export function overlayScreen(): 'live' | 'back' | null {
  const name = isInsideLumora() ? getCurrentWindow().label.replace(/^overlay-/, '') : new URLSearchParams(window.location.search).get('overlay');
  return name === 'live' || name === 'back' ? name : null;
}

export function outputScreen(): ScreenId | null {
  const name = isInsideLumora() ? getCurrentWindow().label.replace(/^output-/, '') : new URLSearchParams(window.location.search).get('output');
  return SCREENS.find((s) => s === name) ?? null;
}
