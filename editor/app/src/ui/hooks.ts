import { useSyncExternalStore } from 'react';
import type { Player } from '../player/player';

/** The playhead (updates every frame while playing). */
export function usePlayhead(player: Player): number {
  return useSyncExternalStore(player.subscribe.bind(player), () => player.time);
}

export function usePlaying(player: Player): boolean {
  return useSyncExternalStore(player.subscribe.bind(player), () => player.isPlaying);
}

export function useSpeed(player: Player): number {
  return useSyncExternalStore(player.subscribe.bind(player), () => player.speed);
}

/** The keyboard belongs to typing while a text box has it. */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
