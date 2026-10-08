// A Blackmagic ATEM switcher next to Lumora (Settings → ATEM switcher…).
// The connection lives in the app (src-tauri/src/atem.rs, crates/atem);
// this is the control window's side: its status, its settings, and buttons.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isInsideLumora } from './client';
import type { Source } from './types/Source';

export interface AtemInput {
  id: number;
  longName: string;
  shortName: string;
  /** 0 external (SDI/HDMI), 1 black, 2 bars, 3 color, 4 media player… */
  portType: number;
}

export type AtemStyle = 'mix' | 'dip' | 'wipe' | 'dve' | 'stinger';

export interface AtemMixEffect {
  program: number;
  preview: number;
  style: AtemStyle;
  mixRate: number;
  inTransition: boolean;
  tbar: number;
  ftbBlack: boolean;
  ftbInTransition: boolean;
  ftbRate: number;
  uskOnAir: boolean[];
}

export interface SwitcherState {
  model: string;
  protocol: [number, number];
  videoMode: number;
  fps: number;
  inputs: Record<string, AtemInput>;
  mixEffects: AtemMixEffect[];
  dsks: { onAir: boolean; inTransition: boolean }[];
  macros: { index: number; name: string }[];
  macroRunning: number | null;
  tally: Record<string, { program: boolean; preview: boolean }>;
  complete: boolean;
}

export interface MapRow {
  sourceId: string;
  atemInput: number;
}

export interface AtemSettings {
  host: string;
  connect: boolean;
  mapping: MapRow[];
  drive: boolean;
  driveHow: 'cut' | 'transition';
  driveBlank: boolean;
  follow: boolean;
  programInput: string | null;
}

export interface AtemStatus {
  settings: AtemSettings;
  connection: 'off' | 'connecting' | 'connected' | 'retrying';
  detail: string | null;
  state: SwitcherState | null;
}

export type AtemCommand =
  | { type: 'cut'; me: number }
  | { type: 'auto'; me: number }
  | { type: 'program'; me: number; input: number }
  | { type: 'preview'; me: number; input: number }
  | { type: 'transitionStyle'; me: number; style: number }
  | { type: 'mixRate'; me: number; frames: number }
  | { type: 'fadeToBlack'; me: number }
  | { type: 'fadeToBlackRate'; me: number; frames: number }
  | { type: 'dskOnAir'; keyer: number; on: boolean }
  | { type: 'dskAuto'; keyer: number }
  | { type: 'uskOnAir'; me: number; keyer: number; on: boolean }
  | { type: 'runMacro'; index: number }
  | { type: 'stopMacro' }
  | { type: 'tbarPosition'; me: number; position: number };

export const STYLES: { style: AtemStyle; byte: number; label: string }[] = [
  { style: 'mix', byte: 0, label: 'Mix' },
  { style: 'dip', byte: 1, label: 'Dip' },
  { style: 'wipe', byte: 2, label: 'Wipe' },
  { style: 'dve', byte: 3, label: 'DVE' },
  { style: 'stinger', byte: 4, label: 'Stinger' },
];

export function defaultAtemSettings(): AtemSettings {
  return { host: '', connect: false, mapping: [], drive: false, driveHow: 'transition', driveBlank: false, follow: true, programInput: null };
}

/** The switcher's inputs for buttons: cameras and other gear first (by number), then black, bars, colors, media players. */
export function atemInputs(st: SwitcherState | null): AtemInput[] {
  if (!st) return [];
  const all = Object.values(st.inputs).filter((i) => i.portType <= 6);
  const external = (i: AtemInput) => i.portType === 0 && i.id > 0 && i.id < 1000;
  return all.sort((a, b) => Number(external(b)) - Number(external(a)) || a.id - b.id);
}

/** An ATEM input's name ("Camera 1", or "Input 5" when it has none). */
export function atemInputName(st: SwitcherState | null, id: number): string {
  const i = st?.inputs[String(id)];
  if (i?.longName) return i.longName;
  return id === 0 ? 'Black' : `Input ${id}`;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A first mapping table: each Lumora camera, stream or capture input whose
 * name matches an ATEM input's long or short name ("Camera 1" / "CAM1"),
 * keeping the rows already set.
 */
export function suggestMapping(sources: Source[], st: SwitcherState | null, current: MapRow[]): MapRow[] {
  const rows = [...current];
  const taken = new Set(rows.map((r) => r.sourceId));
  const inputs = atemInputs(st);
  for (const s of sources) {
    if (taken.has(s.id) || !['camera', 'stream'].includes(s.kind.type)) continue;
    const n = normalize(s.name);
    const hit = inputs.find((i) => normalize(i.longName) === n || (i.shortName && normalize(i.shortName) === n));
    if (hit) {
      rows.push({ sourceId: s.id, atemInput: hit.id });
      taken.add(s.id);
    }
  }
  return rows;
}

/** The mapping with `sourceId` set to `atemInput` (null: removed). */
export function setMapping(rows: MapRow[], sourceId: string, atemInput: number | null): MapRow[] {
  const rest = rows.filter((r) => r.sourceId !== sourceId);
  return atemInput === null ? rest : [...rest, { sourceId, atemInput }];
}

/** An ATEM input's tally. */
export function tallyOf(st: SwitcherState | null, id: number): 'program' | 'preview' | null {
  if (!st) return null;
  const t = st.tally[String(id)];
  const me = st.mixEffects[0];
  if (t?.program || (!t && me?.program === id)) return 'program';
  if (t?.preview || (!t && me?.preview === id)) return 'preview';
  return null;
}

/** "Connected to ATEM Mini Pro", "Connecting to 192.168.10.240…"… */
export function connectionLine(s: AtemStatus): string {
  switch (s.connection) {
    case 'connected':
      return `Connected to ${s.state?.model || 'the switcher'}`;
    case 'connecting':
      return `Connecting to ${s.settings.host}…`;
    case 'retrying':
      return s.detail ?? 'Connecting again…';
    default:
      return s.settings.connect && s.detail ? s.detail : 'Not connected';
  }
}

const NOT_HERE = 'ATEM switchers need the Lumora app.';

export function atemStatus(): Promise<AtemStatus> {
  return isInsideLumora() ? invoke<AtemStatus>('atem_status') : Promise.reject(new Error(NOT_HERE));
}

export function atemSet(settings: AtemSettings): Promise<AtemStatus> {
  return isInsideLumora() ? invoke<AtemStatus>('atem_set', { settings }) : Promise.reject(new Error(NOT_HERE));
}

export function atemSend(...commands: AtemCommand[]): Promise<void> {
  return isInsideLumora() ? invoke('atem_send', { commands }) : Promise.reject(new Error(NOT_HERE));
}

/** Called with the status whenever the switcher or the connection changes. */
export function watchAtem(onChange: (s: AtemStatus) => void): () => void {
  if (!isInsideLumora()) return () => {};
  let stop: (() => void) | undefined;
  let cancelled = false;
  void listen<AtemStatus>('atem-changed', (e) => onChange(e.payload)).then((unlisten) => {
    if (cancelled) unlisten();
    else stop = unlisten;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}
