// Lumora's Stream Deck buttons: is the Stream Deck app here, is the plugin
// in it, and should Lumora offer to add (or update) it? The looking is done
// by src-tauri/src/streamdeck.rs; this decides what to say.

import { invoke } from '@tauri-apps/api/core';

/** See `DeckStatus` in src-tauri/src/streamdeck.rs. */
export interface DeckStatus {
  /** The Stream Deck app is on this computer. */
  found: boolean;
  /** The version of Lumora's plugin in Stream Deck, if it is there. */
  installed: string | null;
  /** The version this Lumora carries (none in development builds). */
  bundled: string | null;
  /** The carried plugin is newer than the one in Stream Deck. */
  update: boolean;
  /** Offer it now (once per version). */
  offer: boolean;
}

export const NO_DECK: DeckStatus = { found: false, installed: null, bundled: null, update: false, offer: false };

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** "1.2.0.0" → "1.2" (trailing zeros dropped, never shorter than two parts). */
export function versionText(v: string): string {
  const parts = v.split('.');
  while (parts.length > 2 && parts[parts.length - 1] === '0') parts.pop();
  return parts.join('.');
}

export interface Offer {
  text: string;
  add: string;
}

/** The one-time offer, or nothing (no Stream Deck, already up to date, or answered). */
export function deckOffer(s: DeckStatus): Offer | null {
  if (!s.found || !s.offer || !s.bundled) return null;
  if (s.installed && s.update) return { text: `New Stream Deck buttons for Lumora are ready (${versionText(s.bundled)}). Update them?`, add: 'Update' };
  if (s.installed) return null;
  return { text: 'Stream Deck found. Add Lumora’s buttons?', add: 'Add' };
}

/** What Settings → Stream Deck says. */
export function deckSummary(s: DeckStatus): { text: string; action: string | null } {
  if (!s.found && !s.installed) return { text: 'The Stream Deck app isn’t on this computer.', action: s.bundled ? 'Install anyway' : null };
  if (!s.bundled)
    return {
      text: s.installed ? `Lumora’s buttons ${versionText(s.installed)} are in Stream Deck.` : 'This copy of Lumora doesn’t carry the Stream Deck buttons.',
      action: null,
    };
  if (!s.installed) return { text: 'Stream Deck found. Lumora’s buttons aren’t in it yet.', action: 'Add the buttons' };
  if (s.update)
    return { text: `Lumora’s buttons ${versionText(s.installed)} are in Stream Deck; ${versionText(s.bundled)} is ready.`, action: 'Update the buttons' };
  return { text: `Lumora’s buttons ${versionText(s.installed)} are in Stream Deck and up to date.`, action: 'Add them again' };
}

export async function deckStatus(): Promise<DeckStatus> {
  return inApp() ? invoke<DeckStatus>('streamdeck_status') : NO_DECK;
}

/** Hand the plugin to the Stream Deck app (it asks, then adds the buttons). */
export async function installDeck(): Promise<DeckStatus> {
  if (!inApp()) throw new Error('The Stream Deck buttons are added from the Lumora app.');
  return invoke<DeckStatus>('streamdeck_install');
}

/** "Not now": not offered again until a newer version. */
export async function dismissDeck(): Promise<DeckStatus> {
  return inApp() ? invoke<DeckStatus>('streamdeck_dismiss') : NO_DECK;
}
