// The program's commands for the render cache and hardware decoding.
import { invoke } from '@tauri-apps/api/core';

export interface CacheEntry {
  key: string;
  bytes: number;
  /** Last written (ms since 1970). */
  at: number;
}

export interface HwStatus {
  mode: 'auto' | 'off';
  method: string | null;
  listed: string[];
  fellBack: boolean;
}

export const cacheNative = {
  /** The folder in use (`folder` empty: the app's own). */
  folder: (folder: string) => invoke<string>('rcache_folder', { folder }),
  list: (folder: string) => invoke<CacheEntry[]>('rcache_list', { folder }),
  /** Start a cache file (frames go through `encode_frame`). */
  open: (folder: string, key: string, width: number, height: number, rate: string, high: boolean, software: boolean) =>
    invoke<number>('rcache_open', { folder, key, width, height, rate, high, software }),
  /** Finish it: its path. */
  finish: (folder: string, key: string, id: number) => invoke<string>('rcache_finish', { folder, key, id }),
  abort: (folder: string, key: string, id: number) => invoke<void>('rcache_abort', { folder, key, id }),
  /** Keep the cache under `limit` bytes (never the keys in `keep`): the keys removed. */
  trim: (folder: string, limit: number, keep: string[]) => invoke<string[]>('rcache_trim', { folder, limit, keep }),
  clear: (folder: string) => invoke<number>('rcache_clear', { folder }),
  hwStatus: () => invoke<HwStatus>('hwaccel_status'),
  hwSet: (auto: boolean) => invoke<void>('hwaccel_set', { auto }),
};
