// Overlay channels (mirrors crates/engine/src/overlays.rs): defaults, the
// rules the demo engine follows, and how each animation looks.

import type { Action } from './types/Action';
import type { Frame } from './types/Frame';
import type { Overlay } from './types/Overlay';
import type { OverlayAnim } from './types/OverlayAnim';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';
import { titlerOutMs } from '../titler/titlerSource';

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

/**
 * Put a Pesukim input over the screen as a bar (an overlay filling the
 * frame), ready in Next or on air (mirrors engine.rs pesukim_bar).
 */
export function pesukimBarIn(s: Show, screen: ScreenId, id: string, on: boolean, now: number): void {
  const n = s.overlays.length;
  if (!n) return;
  let ch = s.overlays.findIndex((o) => o.sourceId === id);
  if (ch < 0) ch = s.overlays.findIndex((o) => !o.sourceId);
  if (ch < 0) ch = n - 1;
  const o = s.overlays[ch]!;
  if (o.sourceId !== id) {
    o.sourceId = id;
    o.on = false;
    o.changedAt = now;
  }
  o.frame = { x: 0, y: 0, w: 100, h: 100 };
  o.opacity = 1;
  if (!o.screens.includes(screen)) o.screens = [screen];
  if (on) {
    setOverlayOn(o, true, now);
    o.inNext = false;
  } else if (!o.on) o.inNext = true;
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

/** Inputs that go over the picture (names, scoreboards…), never instead of it. */
export const OVERLAY_KINDS: ReadonlySet<string> = new Set(['text', 'scoreboard', 'graphic', 'titler', 'comment', 'lyrics']);

/** The overlay channel for an input: the one it is in, else an empty one, else one not on air (else the last). */
export function overlayChannel(show: Show, id: string): number {
  const mine = show.overlays.findIndex((o) => o.sourceId === id);
  if (mine >= 0) return mine;
  const empty = show.overlays.findIndex((o) => !o.sourceId);
  if (empty >= 0) return empty;
  const free = show.overlays.findIndex((o) => !o.on);
  return free >= 0 ? free : show.overlays.length - 1;
}

/** How long a name stays on air before it goes away by itself. */
export const NAME_HOLD_MS = 6000;

/** The steps to put an input over a screen: ready in Next, or straight on air. */
export function overlayActions(show: Show, id: string, screen: ScreenId, onAir: boolean): Action[] {
  const channel = overlayChannel(show, id);
  const acts: Action[] = [];
  const fresh = show.overlays[channel]?.sourceId !== id;
  if (fresh) acts.push({ type: 'setOverlaySource', channel, sourceId: id });
  // A name goes away by itself after a few seconds; a scoreboard stays.
  // Once placed, the seconds set in the overlay's settings are kept.
  const src = show.sources.find((s) => s.id === id);
  const kind = src?.kind.type;
  const hide = fresh ? { autoHideMs: kind === 'text' ? NAME_HOLD_MS : 0 } : {};
  // A Titler graphic plays its own IN and OUT: the channel cuts, and stays on for the OUT.
  const titler = kind === 'titler' ? { animIn: 'cut' as const, animOut: 'cut' as const, animMs: titlerOutMs(src) } : {};
  acts.push({
    type: 'updateOverlay',
    channel,
    patch: { frame: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, screens: [screen === 'monitor' ? 'live' : screen], ...hide, ...titler },
  });
  acts.push(onAir ? { type: 'setOverlayOn', channel, value: true } : { type: 'setOverlayInNext', channel, value: true });
  return acts;
}
