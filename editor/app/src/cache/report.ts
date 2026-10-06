// The playback report in the viewer's dropped-frame light: the frame rate
// achieved against the sequence's, dropped and late frames, the time each
// frame takes to draw against the time there is, and what the render cache
// has done.
import type { PlaybackStats } from '../player/engine';
import type { CacheStats } from './manager';

/** A size in bytes, for people. */
export function bytesText(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/** The report's lines. */
export function playbackReport(s: PlaybackStats, target: number, cache?: CacheStats & { mode: string }): string[] {
  const lines: string[] = [];
  const budget = 1000 / Math.max(1, target);
  const t = Number.isInteger(target) ? String(target) : target.toFixed(2);
  lines.push(s.drawn > 0 ? `Playing at ${s.fps} of ${t} fps` : `Not played yet (the sequence runs at ${t} fps)`);
  lines.push(`Dropped frames: ${s.dropped} · late pictures: ${s.late} · drawn: ${s.drawn}`);
  lines.push(`${s.composeMs.toFixed(1)} ms to draw a frame (${budget.toFixed(1)} ms per frame available)`);
  if (s.drawn > 0 && s.cached > 0) lines.push(`${Math.round((s.cached / s.drawn) * 100)}% of frames came from the render cache`);
  if (cache && cache.mode !== 'off') {
    const rate = cache.ms > 0 ? (cache.frames / (cache.ms / 1000)).toFixed(1) : null;
    lines.push(
      `Render cache (${cache.mode}): ${cache.files} file${cache.files === 1 ? '' : 's'}, ${bytesText(cache.bytes)}` +
        (cache.made ? ` · ${cache.made} made this session${rate ? ` at ${rate} fps` : ''}` : ''),
    );
  }
  return lines;
}
