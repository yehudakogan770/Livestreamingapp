// Blackmagic capture cards (DeckLink, UltraStudio, Intensity): a card input
// is a stream input whose address is `decklink://<card>?input=sdi&audio=3-4`
// (mirrors crates/decklink/src/address.rs). The app opens the card through
// Blackmagic Desktop Video (src-tauri/src/decklink.rs).

import { invoke } from '@tauri-apps/api/core';
import { isInsideLumora } from './client';

export type Connection = 'sdi' | 'hdmi' | 'opticalSdi' | 'component' | 'composite' | 'sVideo';

/** One card (or one of a card's sub-devices). */
export interface CardDevice {
  /** The name Desktop Video gives it ("DeckLink Duo (2)"), kept in the address. */
  name: string;
  model: string;
  canCapture: boolean;
  canPlayout: boolean;
  inputs: Connection[];
  outputs: Connection[];
  detectsFormat: boolean;
  audioChannels: number;
}

/** How an open capture is doing. */
export interface CardSignal {
  url: string;
  device: string;
  state: 'opening' | 'live' | 'noInput' | 'failed';
  detail?: string;
  mode: string | null;
  width: number;
  height: number;
  fps: number;
  pixels: string | null;
  channels: number;
  timecode: string | null;
  frames: number;
}

export interface CardOutputStatus {
  device: string | null;
  mode: string | null;
}

/** The connector as written in an address, and as people say it. */
const KEYS: Record<Connection, { key: string; label: string }> = {
  sdi: { key: 'sdi', label: 'SDI' },
  hdmi: { key: 'hdmi', label: 'HDMI' },
  opticalSdi: { key: 'optical', label: 'Optical SDI' },
  component: { key: 'component', label: 'Component' },
  composite: { key: 'composite', label: 'Composite' },
  sVideo: { key: 'svideo', label: 'S-Video' },
};

export const connectionLabel = (c: Connection): string => KEYS[c].label;

export interface CardAddress {
  device: string;
  connection: Connection | null;
  /** 0 for channels 1–2, up to 7 for channels 15–16. */
  audioPair: number;
}

/** The address of a card input. */
export function cardUrl(a: CardAddress): string {
  const q: string[] = [];
  if (a.connection) q.push(`input=${KEYS[a.connection].key}`);
  if (a.audioPair > 0) q.push(`audio=${a.audioPair * 2 + 1}-${a.audioPair * 2 + 2}`);
  return `decklink://${a.device}${q.length ? `?${q.join('&')}` : ''}`;
}

/** Read a card input's address (null: not one). */
export function parseCardUrl(url: string): CardAddress | null {
  const m = /^decklink:\/\/(.*)$/i.exec(url.trim());
  if (!m) return null;
  const rest = m[1]!;
  const cut = rest.lastIndexOf('?');
  const device = (cut < 0 ? rest : rest.slice(0, cut)).trim();
  if (!device) return null;
  const query = cut < 0 ? '' : rest.slice(cut + 1);
  let connection: Connection | null = null;
  let audioPair = 0;
  for (const kv of query.split('&')) {
    const [k, v = ''] = kv.split('=');
    if (k === 'input') connection = (Object.keys(KEYS) as Connection[]).find((c) => KEYS[c].key === v.toLowerCase()) ?? null;
    if (k === 'audio') {
      const first = Number.parseInt(v, 10);
      if (Number.isFinite(first) && first > 0) audioPair = Math.min(7, v.includes('-') ? Math.floor((first - 1) / 2) : first - 1);
    }
  }
  return { device, connection, audioPair };
}

export const isCardUrl = (url: string): boolean => /^decklink:\/\//i.test(url.trim());

/** The audio pairs a card can give ("Channels 1 and 2"…). */
export function audioPairs(channels: number): { pair: number; label: string }[] {
  const n = Math.max(1, Math.floor(Math.max(2, channels) / 2));
  return Array.from({ length: Math.min(8, n) }, (_, pair) => ({ pair, label: `Channels ${pair * 2 + 1} and ${pair * 2 + 2}` }));
}

/** One line about a capture, for its input: "1080i59.94 · 8-bit YUV · 16 audio channels · TC 10:00:03:12". */
export function signalLine(s: CardSignal): string {
  if (s.state === 'failed') return s.detail ?? 'The card could not capture.';
  if (s.state === 'noInput') return 'No signal on the card’s input.';
  if (s.state === 'opening') return 'Opening the card…';
  const parts = [s.mode ?? (s.width ? `${s.width} × ${s.height}` : null), s.pixels, s.channels ? `${s.channels} audio channels` : null, s.timecode ? `TC ${s.timecode}` : null];
  return parts.filter(Boolean).join(' · ');
}

const NOT_HERE = 'Blackmagic capture cards need the Lumora app on Windows, with Blackmagic Desktop Video.';

/** The cards in this computer (rejects with how to install Desktop Video when it isn't). */
export function cardDevices(): Promise<CardDevice[]> {
  return isInsideLumora() ? invoke<CardDevice[]>('decklink_devices') : Promise.reject(new Error(NOT_HERE));
}

/** How every open capture is doing. */
export function cardSignals(): Promise<CardSignal[]> {
  return isInsideLumora() ? invoke<CardSignal[]>('decklink_signals') : Promise.resolve([]);
}

/** The signal of the capture at `url` (its audio pair aside). */
export function signalFor(all: CardSignal[], url: string): CardSignal | null {
  const a = parseCardUrl(url);
  if (!a) return null;
  const key = cardUrl({ ...a, audioPair: 0 });
  return all.find((s) => s.url === key) ?? null;
}

export function cardOutputStart(device: string, width: number, height: number, fps: number): Promise<CardOutputStatus> {
  return isInsideLumora() ? invoke<CardOutputStatus>('decklink_output_start', { device, width, height, fps }) : Promise.reject(new Error(NOT_HERE));
}

export function cardOutputStop(): Promise<void> {
  return isInsideLumora() ? invoke('decklink_output_stop') : Promise.resolve();
}

export function cardOutputStatus(): Promise<CardOutputStatus> {
  return isInsideLumora() ? invoke<CardOutputStatus>('decklink_output_status') : Promise.resolve({ device: null, mode: null });
}
