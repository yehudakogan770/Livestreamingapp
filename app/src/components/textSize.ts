import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isInsideLumora } from '../engine/client';

/** How big the control window's text and controls are. Remembered on this computer. */
export type TextSize = 'normal' | 'large' | 'xlarge';

export const TEXT_SIZES: { id: TextSize; name: string; scale: number }[] = [
  { id: 'normal', name: 'Normal', scale: 1 },
  { id: 'large', name: 'Large', scale: 1.15 },
  { id: 'xlarge', name: 'Extra large', scale: 1.3 },
];

const KEY = 'lumora.textSize';
/** Bigger than the designs by default: operators work at arm's length. */
export const DEFAULT_TEXT_SIZE: TextSize = 'large';

export function loadTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    return TEXT_SIZES.some((t) => t.id === v) ? (v as TextSize) : DEFAULT_TEXT_SIZE;
  } catch {
    return DEFAULT_TEXT_SIZE;
  }
}

/** Make everything in this window that size (text, buttons and layout together). */
export function applyTextSize(size: TextSize): void {
  const scale = TEXT_SIZES.find((t) => t.id === size)?.scale ?? 1;
  try {
    localStorage.setItem(KEY, size);
  } catch {
    // Not remembered, but still applied.
  }
  if (isInsideLumora()) {
    // The window's own zoom: everything reflows as if the screen were smaller.
    void getCurrentWebview()
      .setZoom(scale)
      .catch(() => {
        document.documentElement.style.setProperty('zoom', String(scale));
      });
  } else {
    document.documentElement.style.setProperty('zoom', String(scale));
  }
}

/** One step bigger or smaller (Ctrl + / Ctrl −). */
export function stepTextSize(size: TextSize, dir: 1 | -1): TextSize {
  const i = TEXT_SIZES.findIndex((t) => t.id === size);
  return TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, i + dir))]!.id;
}
