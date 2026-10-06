// Which kind of device the Planner is on, and so which layout it shows: the
// phone app (tab bar, cards, sheets), the tablet app (sidebar, cue sheet and a
// side panel, sized for fingers) or the computer app (sidebar, table, panel,
// mouse and keyboard). Decided by the pointer and the platform, not by the
// window's width alone: a computer with a narrow window is still a computer
// (it gets a compact desktop layout), and a tablet is not a squeezed desktop.

import { useSyncExternalStore } from 'react';

export type Device = 'phone' | 'tablet' | 'computer';
export type Orientation = 'portrait' | 'landscape';

/** What the browser says about itself, the pointer and the window. */
export interface DeviceEnv {
  ua: string;
  platform: string;
  /** navigator.maxTouchPoints */
  touchPoints: number;
  /** The main pointer is a finger: `(pointer: coarse)`. */
  coarse: boolean;
  /** The main pointer is a mouse, trackpad or pen: `(pointer: fine)`. */
  fine: boolean;
  /** The window's size, in CSS pixels. */
  width: number;
  height: number;
  /** navigator.userAgentData.mobile, where there is one. */
  mobileHint?: boolean;
}

export interface Layout {
  device: Device;
  orientation: Orientation;
  /** A computer with a narrow window: the compact desktop layout (sidebar of icons, details over the sheet). */
  compact: boolean;
}

/** Below this short side, a touch screen gets the phone layout. */
export const PHONE_MAX = 600;
/** Below this width, a computer gets the compact desktop layout. */
export const COMPACT_MAX = 1000;

/**
 * The kind of device. iPhones are phones; iPads (iPadOS reports itself as a
 * Mac with a touch screen), Android and other mobile browsers are phones when
 * the window's short side is under 600px and tablets otherwise. Any other
 * browser whose main pointer is a mouse or trackpad is a computer, touch
 * screen or not (a touch laptop); one with only a finger is sized like a
 * phone or tablet.
 */
export function detectDevice(env: DeviceEnv): Device {
  const short = Math.min(env.width, env.height);
  const byTouch: Device = short < PHONE_MAX ? 'phone' : 'tablet';
  if (/iPhone|iPod/.test(env.ua)) return 'phone';
  const ipad = /iPad/.test(env.ua) || (env.platform === 'MacIntel' && env.touchPoints > 1);
  if (ipad || /Android/i.test(env.ua)) return byTouch;
  if (env.mobileHint || /Mobi|Windows Phone|IEMobile|BlackBerry|BB10|webOS|Opera Mini|Silk|Kindle/i.test(env.ua)) return byTouch;
  if (env.fine) return 'computer';
  if (env.coarse) return byTouch;
  return 'computer';
}

export function layoutFor(env: DeviceEnv): Layout {
  const device = detectDevice(env);
  return {
    device,
    orientation: env.height >= env.width ? 'portrait' : 'landscape',
    compact: device === 'computer' && env.width < COMPACT_MAX,
  };
}

function query(q: string): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  } catch {
    return false;
  }
}

/** This browser, now. */
export function readEnv(): DeviceEnv {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    ua: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    touchPoints: nav.maxTouchPoints ?? 0,
    coarse: query('(pointer: coarse)'),
    fine: query('(pointer: fine)'),
    width: window.innerWidth,
    height: window.innerHeight,
    mobileHint: nav.userAgentData?.mobile,
  };
}

let current: Layout | null = null;
const listeners = new Set<() => void>();

function same(a: Layout | null, b: Layout): boolean {
  return !!a && a.device === b.device && a.orientation === b.orientation && a.compact === b.compact;
}

/** Mark <html> with the layout, for the styles: data-device, data-orient and data-compact. */
function mark(l: Layout) {
  const el = document.documentElement;
  el.dataset.device = l.device;
  el.dataset.orient = l.orientation;
  if (l.compact) el.dataset.compact = '';
  else delete el.dataset.compact;
}

/** Look again (the window was resized or turned, or a mouse came or went). */
export function refreshDevice(): Layout {
  const next = layoutFor(readEnv());
  if (!same(current, next)) {
    current = next;
    mark(next);
    for (const f of listeners) f();
  }
  return current!;
}

let watching = false;
/** Keep the layout current: on resizing, turning the device, and the pointer changing. */
export function watchDevice(): void {
  refreshDevice();
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const f = () => void refreshDevice();
  window.addEventListener('resize', f);
  window.addEventListener('orientationchange', f);
  if (typeof window.matchMedia === 'function')
    for (const q of ['(pointer: fine)', '(pointer: coarse)', '(any-pointer: fine)']) {
      try {
        window.matchMedia(q).addEventListener?.('change', f);
      } catch {
        // An old browser: the size still updates it.
      }
    }
}

function subscribe(f: () => void) {
  watchDevice();
  listeners.add(f);
  return () => listeners.delete(f);
}

function snapshot(): Layout {
  return current ?? refreshDevice();
}

/** The layout now: the device, which way up it is, and whether a computer's window is narrow. */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, snapshot);
}

export function useDevice(): Device {
  return useLayout().device;
}
