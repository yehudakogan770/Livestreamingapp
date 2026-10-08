// Talks to Lumora's seats (src-tauri/src/seats.rs). Two sides:
// - the show computer: other computers join it (Settings → Operators…);
// - a joining computer: it joins another computer's show (Settings → Join a
//   show on this network…) and runs it from the seat window.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Action } from '../engine/types/Action';
import type { Show } from '../engine/types/Show';
import type { Role } from './roles';

export interface PendingSeat {
  id: number;
  name: string;
  address: string;
  /** The code the person at the other computer types. */
  code: string;
  codeTyped: boolean;
  approved: boolean;
}

export interface SeatInfo {
  id: string;
  name: string;
  role: Role;
  locked: boolean;
  connected: boolean;
  address: string | null;
  latencyMs: number | null;
  since: number | null;
}

export interface SeatsStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  addresses: string[];
  error: string | null;
  show: string;
  pending: PendingSeat[];
  seats: SeatInfo[];
}

export interface SeatView {
  id: string;
  name: string;
  role: Role;
  locked: boolean;
}

export type LinkStatus =
  | { state: 'idle' }
  | { state: 'connecting'; address: string }
  | { state: 'enterCode'; show: string; wrong: boolean }
  | { state: 'waiting'; show: string }
  | { state: 'connected'; show: string; seat: SeatView; rttMs: number | null }
  | { state: 'reconnecting'; show: string; tries: number; problem: string }
  | { state: 'ended'; reason: string };

export interface FoundShow {
  id: string;
  name: string;
  address: string;
}

export interface SavedShow {
  showId: string;
  show: string;
  address: string;
  name: string;
}

/** What the control window reports as running on the show computer. */
export interface ShowAppState {
  recording?: boolean;
  streaming?: boolean;
  rehearsal?: boolean;
  replay?: boolean;
  busy?: boolean;
  reconnecting?: number;
  error?: string | null;
}

/** The document a seat keeps (crates/seats/src/sync.rs). */
export interface SeatDocument {
  revision: number;
  show: Show;
  app: ShowAppState;
}

/** PTZ moves, as src-tauri/src/ptz.rs takes them. */
export type PtzMove =
  | { type: 'move'; pan: number; tilt: number; speed: number }
  | { type: 'stop' }
  | { type: 'zoom'; dir: -1 | 0 | 1; speed: number }
  | { type: 'home' }
  | { type: 'recall'; preset: number }
  | { type: 'store'; preset: number }
  | { type: 'autoFocus' };

/** Recording, streaming and replay (src-tauri/src/remote.rs AppCommand). */
export type SeatCommand =
  | { command: 'record'; on: boolean }
  | { command: 'stream'; on: boolean }
  | { command: 'rehearsal'; on: boolean }
  | { command: 'replayBuffer'; on: boolean }
  | { command: 'replay'; seconds: number; slow?: boolean };

function errorText(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

function follow<T>(event: string, cb: (payload: T) => void): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void listen<T>(event, (e) => cb(e.payload)).then((unlisten) => {
    if (cancelled) unlisten();
    else stop = unlisten;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}

/** The show computer's side. */
export interface OperatorsApi {
  status(): Promise<SeatsStatus>;
  setEnabled(on: boolean): Promise<SeatsStatus>;
  approve(pending: number, role: Role): Promise<SeatsStatus>;
  deny(pending: number): Promise<SeatsStatus>;
  setRole(seat: string, role: Role): Promise<SeatsStatus>;
  setLocked(seat: string, locked: boolean): Promise<SeatsStatus>;
  remove(seat: string): Promise<SeatsStatus>;
  /** Called whenever seats join, leave or change. */
  watch(cb: (s: SeatsStatus) => void): () => void;
}

const call = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args).catch((e: unknown) => Promise.reject(errorText(e)));

export const operatorsApi: OperatorsApi = {
  status: () => call('seats_status'),
  setEnabled: (on) => call('seats_set_enabled', { on }),
  approve: (pending, role) => call('seats_approve', { pending, role }),
  deny: (pending) => call('seats_deny', { pending }),
  setRole: (seat, role) => call('seats_set_role', { seat, role }),
  setLocked: (seat, locked) => call('seats_set_locked', { seat, locked }),
  remove: (seat) => call('seats_remove', { seat }),
  watch: (cb) => follow<SeatsStatus>('seats-changed', cb),
};

/** The joining computer's side. */
export interface JoinApi {
  discover(): Promise<FoundShow[]>;
  computerName(): Promise<string>;
  saved(): Promise<SavedShow[]>;
  join(address: string, name: string): Promise<LinkStatus>;
  rejoin(showId: string): Promise<LinkStatus>;
  forget(showId: string): Promise<SavedShow[]>;
  code(code: string): Promise<LinkStatus>;
  openWindow(): Promise<void>;
  leave(): Promise<void>;
  status(): Promise<LinkStatus>;
  onStatus(cb: (s: LinkStatus) => void): () => void;
}

export const joinApi: JoinApi = {
  discover: () => call('seat_discover'),
  computerName: () => call('seat_computer_name'),
  saved: () => call('seat_saved'),
  join: (address, name) => call('seat_join', { address, name }),
  rejoin: (showId) => call('seat_rejoin', { showId }),
  forget: (showId) => call('seat_forget', { showId }),
  code: (code) => call('seat_code', { code }),
  openWindow: () => call('seat_open_window'),
  leave: () => call('seat_leave'),
  status: () => call('seat_status'),
  onStatus: (cb) => follow<LinkStatus>('seat-status', cb),
};

/** The seat window's link to the show computer. */
export interface SeatApi {
  status(): Promise<LinkStatus>;
  document(): Promise<SeatDocument | null>;
  action(action: Action): Promise<void>;
  command(command: SeatCommand): Promise<void>;
  ptz(source: string, move: PtzMove): Promise<void>;
  watchKeys(keys: string[]): Promise<void>;
  picture(key: string): Promise<ArrayBuffer>;
  leave(): Promise<void>;
  onStatus(cb: (s: LinkStatus) => void): () => void;
  onDocument(cb: (d: SeatDocument) => void): () => void;
  onPicture(cb: (key: string) => void): () => void;
  onMeters(cb: (m: Record<string, number>) => void): () => void;
}

export const seatApi: SeatApi = {
  status: () => call('seat_status'),
  document: () => call('seat_document'),
  action: (action) => call('seat_action', { action }),
  command: (command) => call('seat_command', { command }),
  ptz: (source, move) => call('seat_ptz', { source, command: move }),
  watchKeys: (keys) => call('seat_watch', { keys }),
  picture: (key) => call('seat_picture', { key }),
  leave: () => call('seat_leave'),
  onStatus: (cb) => follow<LinkStatus>('seat-status', cb),
  onDocument: (cb) => follow<SeatDocument>('seat-document', cb),
  onPicture: (cb) => follow<{ key: string }>('seat-picture', (p) => cb(p.key)),
  onMeters: (cb) => follow<Record<string, number>>('seat-meters', cb),
};

/** The show computer's control window feeding pictures and levels to seats. */
export const feedApi = {
  watched: () => call<string[]>('seats_watched'),
  picture: (key: string, jpeg: ArrayBuffer) => invoke('seats_picture', new Uint8Array(jpeg), { headers: { key } }),
  meters: (meters: Record<string, number>) => call('seats_meters', { meters }),
};

/** "Connected to Spring Gala as Graphics". */
export function seatLine(s: LinkStatus, roleName: (r: Role) => string): string {
  switch (s.state) {
    case 'connected':
      return `Connected to ${s.show} as ${roleName(s.seat.role)}${s.seat.locked ? ' (locked by the show operator)' : ''}`;
    case 'reconnecting':
      return `Reconnecting to ${s.show}…`;
    case 'connecting':
      return 'Connecting…';
    case 'enterCode':
      return `Type the code shown on ${s.show}`;
    case 'waiting':
      return `Waiting for the show operator at ${s.show} to let you in…`;
    case 'ended':
      return s.reason;
    case 'idle':
      return 'Not connected to a show';
  }
}
