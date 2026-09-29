// What the "scan to join" corner shows at a moment: the audience page's code,
// or — when the page is only on the local network and the event has a guest
// Wi-Fi — taking turns with the code that joins the Wi-Fi. The same in every
// window and the recording.

import type { GuestWifi } from './types/GuestWifi';

/** Seconds each code stays when they take turns. */
export const JOIN_TURN_MS = 8000;

export interface JoinShown {
  qr: string;
  label: string;
  /** The small line under it (the address, or the Wi-Fi's name). */
  sub: string;
}

/** The page is on the local network (not the internet link). */
export const localOnly = (url: string) => url.startsWith('http://');

/** Whether the corner takes turns with the Wi-Fi code. */
export const takesTurns = (url: string, wifi: GuestWifi | undefined) => !!wifi?.show && !!wifi.qr && localOnly(url);

export function joinShown(url: string, qr: string, label: string, wifi: GuestWifi | undefined, now: number): JoinShown {
  const page = { qr, label, sub: url.replace(/^https?:\/\//, '') };
  if (!wifi || !takesTurns(url, wifi)) return page;
  const wifiTurn = Math.floor(now / JOIN_TURN_MS) % 2 === 0;
  return wifiTurn ? { qr: wifi.qr, label: '1 · Join the Wi-Fi', sub: `Wi-Fi: ${wifi.name}` } : { ...page, label: `2 · ${label}` };
}
