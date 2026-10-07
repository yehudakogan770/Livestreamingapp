// Presentation clickers (USB or Bluetooth): they type Page Down / Page Up
// (some send the arrow keys) and "b" or "." to black the screen. With
// Settings → "Presentation clicker controls the slideshow" on, Lumora
// answers those keys anywhere in the control window.

import type { Action } from './types/Action';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';
import type { Slideshow } from './types/Slideshow';
import { slideshowTarget } from './slideshow';

export type ClickerMove = 'next' | 'previous' | 'black';

/** What a clicker key does (null: not a clicker key). */
export function clickerMove(key: string): ClickerMove | null {
  switch (key) {
    case 'PageDown':
    case 'ArrowRight':
      return 'next';
    case 'PageUp':
    case 'ArrowLeft':
      return 'previous';
    case 'b':
    case 'B':
    case '.':
      return 'black';
    default:
      return null;
  }
}

/**
 * The slideshow a clicker works on: the one in Next or on air on the screen
 * being controlled (like the slideshow controls), else one on air anywhere.
 */
export function clickerTarget(show: Show, screen: ScreenId): { id: string; sh: Slideshow } | null {
  const here = slideshowTarget(show, screen === 'monitor' ? 'live' : screen);
  if (here) return here;
  for (const sc of ['live', 'back'] as const) {
    const t = slideshowTarget(show, sc);
    if (t?.where === 'onAir') return t;
  }
  return null;
}

/** The action for a clicker key. */
export function clickerAction(move: ClickerMove, target: { id: string; sh: Slideshow }): Action {
  if (move === 'next') return { type: 'slideNext', id: target.id };
  if (move === 'previous') return { type: 'slidePrevious', id: target.id };
  return { type: 'slideBlack', id: target.id, value: !target.sh.black };
}

const KEY = 'lumora.clicker';

/** Is the clicker setting on (on this computer)? */
export function loadClicker(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function saveClicker(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Not remembered, but still on for now.
  }
}
