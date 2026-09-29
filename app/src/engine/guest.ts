// Guests by link (mirrors Guest in crates/engine/src/browser.rs): the guest
// sends camera and microphone through VDO.Ninja; Lumora receives them in a
// page window. Uses the internet only while a guest input exists.

import type { BrowserInput } from './types/BrowserInput';
import type { Guest } from './types/Guest';
import { defaultBrowser } from './browser';

/** A private room name: 16 random letters and digits. */
export function newRoom(): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `lumora${[...bytes].map((b) => abc[b % abc.length]).join('')}`;
}

/** The link the guest opens on their phone or computer. */
export const inviteUrl = (g: Guest, name: string) =>
  `https://vdo.ninja/?push=${g.room}&webcam&label=${name.replace(/[^A-Za-z0-9]/g, '').slice(0, 30)}&quality=0`;

/** The page that receives the guest (the same as the app opens). */
export const guestPage = (g: Guest): BrowserInput => ({
  ...defaultBrowser(),
  url: `https://vdo.ninja/?view=${g.room}&cleanoutput&scale=100&noaudioprocessing`,
  width: 1280,
  height: 720,
  viewOnly: true,
  reload: g.reload,
});
