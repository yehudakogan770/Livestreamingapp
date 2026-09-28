import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ScreenId } from './types/ScreenId';
import { isInsideLumora } from './client';

const SCREENS: ScreenId[] = ['live', 'back', 'monitor'];

/**
 * Which screen this window outputs, or null for the control window.
 * Inside Lumora the window label says it (`output-live`); in a browser,
 * `?output=live` does the same so outputs can be tried without the app.
 */
export function outputScreen(): ScreenId | null {
  const name = isInsideLumora()
    ? getCurrentWindow().label.replace(/^output-/, '')
    : new URLSearchParams(window.location.search).get('output');
  return SCREENS.find((s) => s === name) ?? null;
}
