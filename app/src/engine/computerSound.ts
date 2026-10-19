// "This computer's sound" inputs (mirrors src-tauri/src/computer_sound.rs):
// sound inputs whose device is `lumora:computer` (everything this computer
// plays, except Lumora's own sound) or `lumora:app:<program file>` (one
// program and the programs it started). Windows takes the sound; the app
// serves it like a stream input's sound.

import { useEffect, useState } from 'react';
import type { Source } from './types/Source';

export const EVERYTHING = 'lumora:computer';
export const PROGRAM = 'lumora:app:';

export const isComputerSound = (deviceId: string): boolean => deviceId === EVERYTHING || deviceId.startsWith(PROGRAM);

/** A sound input that is a real microphone (or line in), not the computer's own sound. */
export const isMicrophone = (s: Source): boolean => s.kind.type === 'microphone' && !isComputerSound(s.kind.deviceId);

/** A program a "This computer's sound" input can follow. */
export interface ProgramChoice {
  /** `lumora:app:spotify.exe` */
  deviceId: string;
  name: string;
}

export interface ComputerSoundChoices {
  /** This computer can take its own sound (Windows). */
  available: boolean;
  /** The programs playing sound now. */
  programs: ProgramChoice[];
}

export interface ComputerSoundStatus {
  id: string;
  state: 'on' | 'waiting' | 'failed';
  detail: string | null;
}

/** The program's name from its device ("lumora:app:spotify.exe" → "Spotify"). */
export function programName(deviceId: string): string {
  const exe = deviceId.startsWith(PROGRAM) ? deviceId.slice(PROGRAM.length) : deviceId;
  const stem = exe.replace(/\.exe$/i, '');
  return stem ? stem[0]!.toUpperCase() + stem.slice(1) : 'Program';
}

let known: ComputerSoundChoices | null = null;
let asking: Promise<ComputerSoundChoices> | null = null;

/** What this computer can take (asked once a session; null until known). */
export function useComputerSoundAvailable(ask: () => Promise<ComputerSoundChoices>): boolean {
  const [available, setAvailable] = useState(known?.available ?? false);
  useEffect(() => {
    if (known) return;
    let alive = true;
    asking ??= ask().catch(() => ({ available: false, programs: [] }));
    void asking.then((c) => {
      known = c;
      if (alive) setAvailable(c.available);
    });
    return () => {
      alive = false;
    };
  }, [ask]);
  return available;
}
