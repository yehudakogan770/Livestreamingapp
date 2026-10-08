// The Lumora Titler desktop app's host (and the file it was opened with).

import { invoke } from '@tauri-apps/api/core';
import type { Host } from '../designer/host';
import { tauriHost } from './tauriHost';

export async function desktopHost(): Promise<Host> {
  return tauriHost('desktop');
}

/** The .lumtitle file the app was opened with (double-clicked), if any. */
export function initialFile(): Promise<string | null> {
  return invoke<string | null>('initial_file').catch(() => null);
}
