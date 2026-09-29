// Video playlists (mirrors crates/engine/src/playlist.rs).

import type { Playlist } from './types/Playlist';
import type { Source } from './types/Source';
import { sourceEnded } from './timing';

export const MAX_ITEMS = 500;

export function repairPlaylist(p: Playlist): void {
  p.items = p.items.filter((i) => i.path !== '').slice(0, MAX_ITEMS);
  for (const i of p.items) {
    if (!Number.isFinite(i.durationS) || i.durationS < 0) i.durationS = 0;
    i.name = [...i.name].slice(0, 120).join('');
  }
  p.current = Math.min(p.current, Math.max(0, p.items.length - 1));
}

/** The item after the current one, or null. */
export function nextIndex(p: Playlist): number | null {
  if (p.current + 1 < p.items.length) return p.current + 1;
  return p.loopAll && p.items.length > 0 ? 0 : null;
}

/** The current video just ended and the list goes on by itself. */
export function playlistDue(src: Source, now: number): boolean {
  const p = src.playlist;
  return !!p && src.kind.type === 'video' && p.autoNext && src.kind.playback.playing && nextIndex(p) !== null && sourceEnded(src, now);
}

/** Make item `index` the input's video, from the start. */
export function playlistGo(src: Source, index: number, playing: boolean, now: number): boolean {
  const p = src.playlist;
  const item = p?.items[index];
  if (!p || !item || src.kind.type !== 'video') return false;
  p.current = index;
  src.kind.path = item.path;
  src.kind.durationS = item.durationS;
  src.kind.playback = { playing, posS: 0, at: now };
  return true;
}

/** Total length of the list, in seconds (items not measured yet count 0). */
export const playlistLength = (p: Playlist) => p.items.reduce((n, i) => n + i.durationS, 0);
