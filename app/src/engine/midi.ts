// MIDI controllers: any pad, button box or fader (APC, Launchpad, X-Touch,
// nanoKONTROL…) can run the show. Each function is "learned": press Learn,
// then the button or move the fader. Kept on this computer.

import type { Action } from './types/Action';
import type { Show } from './types/Show';
import type { ScreenId } from './types/ScreenId';

export interface MidiFunction {
  id: string;
  name: string;
  /** Buttons act when pressed; faders follow the knob or slider. */
  kind: 'button' | 'fader';
  group: string;
}

const inputs = (n: number, id: string, name: (i: number) => string, group: string): MidiFunction[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${id}${i + 1}`, name: name(i + 1), kind: 'button' as const, group }));

export const MIDI_FUNCTIONS: MidiFunction[] = [
  { id: 'take', name: 'TAKE', kind: 'button', group: 'Switching' },
  { id: 'cut', name: 'CUT', kind: 'button', group: 'Switching' },
  { id: 'tbar', name: 'T-bar', kind: 'fader', group: 'Switching' },
  ...inputs(4, 'fav', (i) => `Favourite transition ${i}`, 'Switching'),
  { id: 'ftb', name: 'Fade to black', kind: 'button', group: 'Switching' },
  { id: 'blank', name: 'Blank on / off', kind: 'button', group: 'Switching' },
  ...inputs(12, 'next', (i) => `Input ${i} to Next`, 'Inputs'),
  ...inputs(12, 'air', (i) => `Input ${i} straight to air`, 'Inputs'),
  ...inputs(4, 'ov', (i) => `Overlay ${i} on / off`, 'Overlays'),
  { id: 'ovoff', name: 'All overlays off', kind: 'button', group: 'Overlays' },
  { id: 'cue', name: 'Next cue', kind: 'button', group: 'Show' },
  { id: 'panic', name: 'PANIC on / off', kind: 'button', group: 'Show' },
  { id: 'master', name: 'Master volume', kind: 'fader', group: 'Sound' },
  { id: 'mute', name: 'Master mute', kind: 'button', group: 'Sound' },
];

/** A learned control: which message it is. */
export type MidiKey = string;
export type MidiMap = Record<string, MidiKey>;

const STORE = 'lumora.midi';

export function loadMidiMap(): MidiMap {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as MidiMap) : {};
  } catch {
    return {};
  }
}

export function saveMidiMap(m: MidiMap): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(m));
  } catch {
    // Private window or storage off: works until the app closes.
  }
}

/** A MIDI message as a key and a value (0 – 1), or null for ones we ignore. */
export function readMessage(data: Uint8Array): { key: MidiKey; value: number; press: boolean } | null {
  if (data.length < 3) return null;
  const type = data[0]! & 0xf0;
  const ch = (data[0]! & 0x0f) + 1;
  const n = data[1]!;
  const v = data[2]!;
  if (type === 0x90) return { key: `note ${ch}:${n}`, value: v / 127, press: v > 0 };
  if (type === 0x80) return { key: `note ${ch}:${n}`, value: 0, press: false };
  if (type === 0xb0) return { key: `cc ${ch}:${n}`, value: v / 127, press: v >= 64 };
  return null;
}

/** A learned key, readable: "Note 36 (ch 1)". */
export function keyName(k: MidiKey): string {
  const m = /^(note|cc) (\d+):(\d+)$/.exec(k);
  if (!m) return k;
  return `${m[1] === 'note' ? 'Note' : 'Knob/CC'} ${m[3]} (ch ${m[2]})`;
}

/** What a function does, given the show and the screen being controlled. */
export function midiAction(id: string, value: number, show: Show, screen: ScreenId): Action | null {
  const sc = screen === 'monitor' ? 'live' : screen;
  const at = (n: string) => show.sources[Number(n) - 1]?.id;
  const m = /^(next|air|ov|fav)(\d+)$/.exec(id);
  if (m) {
    const [, what, n] = m;
    if (what === 'next' && at(n!)) return { type: 'setPreview', screen: sc, sourceId: at(n!)! };
    if (what === 'air' && at(n!)) return { type: 'cutTo', screen: sc, sourceId: at(n!)! };
    if (what === 'ov') {
      const ch = Number(n) - 1;
      const o = show.overlays[ch];
      return o ? { type: 'setOverlayOn', channel: ch, value: !o.on } : null;
    }
    if (what === 'fav') {
      const f = show.settings.favouriteTransitions[Number(n) - 1];
      return f ? { type: 'take', screen: sc, transition: f.kind, durationMs: f.durationMs } : null;
    }
    return null;
  }
  switch (id) {
    case 'take':
      return { type: 'take', screen: sc };
    case 'cut':
      return { type: 'take', screen: sc, transition: 'cut' };
    case 'tbar':
      return { type: 'setTbar', screen: sc, value };
    case 'ftb':
      return { type: 'fadeToBlack', screen: sc };
    case 'blank':
      return { type: 'setBlank', screens: [sc], value: !show.screens[sc].blank };
    case 'ovoff':
      return { type: 'overlaysOff' };
    case 'cue':
      return { type: 'nextCue' };
    case 'panic':
      return { type: 'panic', value: !show.panic };
    case 'master':
      return { type: 'setMasterVolume', value };
    case 'mute':
      return { type: 'setMasterMuted', value: !show.audio.masterMuted };
  }
  return null;
}

type Listener = (msg: { key: MidiKey; value: number; press: boolean }) => void;

/** Listens to every connected MIDI device, including ones plugged in later. */
export class MidiIn {
  private access: MIDIAccess | null = null;
  private readonly listeners = new Set<Listener>();
  devices: string[] = [];
  error: string | null = null;
  onDevices: (() => void) | null = null;

  async start(): Promise<void> {
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      this.error = 'MIDI isn’t available here. It works in the Windows app.';
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      this.error = 'MIDI was not allowed.';
      return;
    }
    const hook = () => {
      if (!this.access) return;
      this.devices = [];
      this.access.inputs.forEach((input) => {
        this.devices.push(input.name ?? 'MIDI device');
        input.onmidimessage = (e) => {
          const msg = e.data && readMessage(e.data);
          if (msg) this.listeners.forEach((l) => l(msg));
        };
      });
      this.onDevices?.();
    };
    this.access.onstatechange = hook;
    hook();
  }

  listen(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  stop(): void {
    this.access?.inputs.forEach((i) => (i.onmidimessage = null));
    if (this.access) this.access.onstatechange = null;
    this.listeners.clear();
  }
}
