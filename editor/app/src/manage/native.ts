// The program's commands for delivery and media management (encoders, shots,
// collecting files, the recovery folder).
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inApp } from '../native';

export interface RecoveryEntry {
  name: string;
  size: number;
  /** Milliseconds since 1970. */
  modified: number;
}

/** One file to collect: copied, or made by FFmpeg (`{in}` and `{out}` in the arguments). */
export interface CollectJob {
  from: string;
  to: string;
  args?: string[] | null;
}

export interface CollectProgress {
  done: number;
  of: number;
  name: string;
  finished: boolean;
  problems: string[];
}

export const manageNative = {
  /** The encoders that work on this computer (hardware ones are tried for real). */
  encoders: () => invoke<string[]>('encoders_available'),
  encodeOpen: (args: string[], tmp: string, out: string, frameBytes: number) => invoke<number>('encode_open', { args, tmp, out, frameBytes }),
  encodeFrame: (id: number, data: Uint8Array) => invoke<void>('encode_frame', data, { headers: { 'x-encoder': String(id) } }),
  encodeClose: (id: number) => invoke<void>('encode_close', { id }),
  encodeAbort: (id: number) => invoke<void>('encode_abort', { id }),
  sceneCuts: (path: string, threshold: number) => invoke<number[]>('scene_cuts', { path, threshold }),
  collectFiles: (jobs: CollectJob[]) => invoke<string[]>('collect_files', { jobs }),
  recoveryWrite: (name: string, text: string) => invoke<void>('recovery_write', { name, text }),
  recoveryRead: (name: string) => invoke<string>('recovery_read', { name }),
  recoveryList: () => invoke<RecoveryEntry[]>('recovery_list'),
  recoveryRemove: (name: string) => invoke<void>('recovery_remove', { name }),
};

export function onCollectProgress(f: (p: CollectProgress) => void): () => void {
  if (!inApp()) return () => {};
  let stop: (() => void) | null = null;
  let gone = false;
  void listen<CollectProgress>('collect-progress', (e) => f(e.payload)).then((u) => {
    if (gone) u();
    else stop = u;
  });
  return () => {
    gone = true;
    stop?.();
  };
}
