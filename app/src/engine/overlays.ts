// Overlay channels (mirrors crates/engine/src/overlays.rs): defaults, the
// rules the demo engine follows, and how each animation looks.

import type { Frame } from './types/Frame';
import type { Overlay } from './types/Overlay';
import type { OverlayAnim } from './types/OverlayAnim';
import type { ScreenId } from './types/ScreenId';

export const CHANNELS = 4;

export function defaultOverlay(): Overlay {
  return {
    sourceId: null,
    frame: { x: 0, y: 0, w: 100, h: 100 },
    opacity: 1,
    animIn: 'fade',
    animOut: 'fade',
    animMs: 500,
    autoHideMs: null,
    screens: ['live'],
    on: false,
    inNext: false,
    changedAt: 0,
  };
}

export const channels = (): Overlay[] => Array.from({ length: CHANNELS }, defaultOverlay);

/** Inside the screen, at least 1% big. */
export function clampFrame(f: Frame): Frame {
  const fix = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  const w = Math.min(100, Math.max(1, fix(f.w, 100)));
  const h = Math.min(100, Math.max(1, fix(f.h, 100)));
  return { x: Math.min(100 - w, Math.max(0, fix(f.x, 0))), y: Math.min(100 - h, Math.max(0, fix(f.y, 0))), w, h };
}

export function repairOverlay(o: Overlay): void {
  o.frame = clampFrame(o.frame);
  o.opacity = Number.isFinite(o.opacity) ? Math.min(1, Math.max(0, o.opacity)) : 1;
  o.animMs = Math.min(5000, Math.max(0, o.animMs));
  if (o.autoHideMs !== null) o.autoHideMs = Math.min(600_000, Math.max(500, o.autoHideMs));
  o.screens = [...new Set(o.screens.filter((s) => s !== 'monitor'))];
  if (o.sourceId === null) {
    o.on = false;
    o.inNext = false;
  }
}

export function setOverlayOn(o: Overlay, on: boolean, now: number): void {
  if (o.on !== on) {
    o.on = on;
    o.changedAt = now;
  }
}

/** On air, or still animating out. */
export function overlayShowing(o: Overlay, now: number): boolean {
  return o.sourceId !== null && (o.on || now - o.changedAt < o.animMs);
}

/** Ready-made places for an overlay. */
export const PLACES: { name: string; frame: Frame }[] = [
  { name: 'Full screen', frame: { x: 0, y: 0, w: 100, h: 100 } },
  { name: 'Logo, top right', frame: { x: 86, y: 5, w: 10, h: 12 } },
  { name: 'Logo, top left', frame: { x: 4, y: 5, w: 10, h: 12 } },
  { name: 'Lower third', frame: { x: 6, y: 72, w: 50, h: 16 } },
  { name: 'Picture-in-picture', frame: { x: 70, y: 6, w: 26, h: 26 } },
  { name: 'Right half', frame: { x: 50, y: 0, w: 50, h: 100 } },
];

export const ANIMS: { id: OverlayAnim; name: string }[] = [
  { id: 'cut', name: 'Cut' },
  { id: 'fade', name: 'Fade' },
  { id: 'slideLeft', name: 'Slide from the left' },
  { id: 'slideRight', name: 'Slide from the right' },
  { id: 'slideUp', name: 'Slide up' },
  { id: 'zoom', name: 'Zoom' },
  { id: 'wipe', name: 'Wipe' },
];

/**
 * Keyframes for an overlay coming in (`in`) or going out: from hidden to
 * shown for in, shown to hidden for out.
 */
export function overlayKeyframes(anim: OverlayAnim, dir: 'in' | 'out'): Keyframe[] {
  const shown: Keyframe = { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' };
  const hidden: Keyframe = (() => {
    switch (anim) {
      case 'cut':
        return { ...shown };
      case 'fade':
        return { ...shown, opacity: 0 };
      case 'slideLeft':
        return { ...shown, transform: 'translateX(-110%)' };
      case 'slideRight':
        return { ...shown, transform: 'translateX(110%)' };
      case 'slideUp':
        return { ...shown, transform: 'translateY(110%)' };
      case 'zoom':
        return { ...shown, opacity: 0, transform: 'scale(0.6)' };
      case 'wipe':
        return { ...shown, clipPath: 'inset(0 100% 0 0)' };
    }
  })();
  return dir === 'in' ? [hidden, shown] : [shown, hidden];
}

/** How far through its animation an overlay is (0 – 1) and which way, at `now`. */
export function overlayMotion(o: Overlay, now: number): { dir: 'in' | 'out'; p: number } {
  const p = o.animMs > 0 ? Math.min(1, Math.max(0, (now - o.changedAt) / o.animMs)) : 1;
  return { dir: o.on ? 'in' : 'out', p };
}

/** The overlay's look for drawing by hand (recordings): opacity, offset and reveal. */
export function overlayLook(o: Overlay, now: number): { opacity: number; dx: number; dy: number; scale: number; reveal: number } | null {
  if (!overlayShowing(o, now)) return null;
  const { dir, p } = overlayMotion(o, now);
  const anim = dir === 'in' ? o.animIn : o.animOut;
  const e = dir === 'in' ? 1 - (1 - p) ** 3 : p * p * p;
  // t: 1 = fully shown, 0 = hidden.
  const t = anim === 'cut' ? (dir === 'in' ? 1 : p >= 1 ? 0 : 1) : dir === 'in' ? e : 1 - e;
  const off = 1 - t;
  return {
    opacity: o.opacity * (anim === 'fade' || anim === 'zoom' ? t : 1),
    dx: anim === 'slideLeft' ? -1.1 * off : anim === 'slideRight' ? 1.1 * off : 0,
    dy: anim === 'slideUp' ? 1.1 * off : 0,
    scale: anim === 'zoom' ? 0.6 + 0.4 * t : 1,
    reveal: anim === 'wipe' ? t : 1,
  };
}

/** Overlays showing on a screen, in channel order (4 on top). */
export function overlaysOn(overlays: Overlay[], screen: ScreenId, now: number): { channel: number; o: Overlay }[] {
  return overlays.map((o, channel) => ({ channel, o })).filter(({ o }) => o.screens.includes(screen) && overlayShowing(o, now));
}
