// Rehearsal: the whole event runs exactly as if live (pictures drawn,
// encoded and handed to the streaming program), but nothing is sent. What
// went wrong along the way is noted, for the report at the end.

import type { Problem } from '../problems/problems';

export interface RehearsalReport {
  minutes: number;
  /** Problems that came up, in order (each once). */
  problems: { title: string; level: Problem['level']; at: number }[];
  /** Frames the picture missed (the computer was too busy). */
  dropped: number;
  /** The lowest speed the streaming program kept up with (1 = real time). */
  slowest: number | null;
}

export class RehearsalLog {
  private readonly started = Date.now();
  private readonly seen = new Map<string, { title: string; level: Problem['level']; at: number }>();
  private dropped = 0;
  private slowest: number | null = null;

  /** The problems showing now (new ones are noted). */
  problems(list: Problem[], now = Date.now()): void {
    for (const p of list) if (!this.seen.has(p.key)) this.seen.set(p.key, { title: p.title, level: p.level, at: now - this.started });
  }

  /** How the computer kept up just now. */
  sample(dropped: number | null, speed: number | null): void {
    if (dropped !== null) this.dropped = Math.max(this.dropped, dropped);
    if (speed !== null) this.slowest = this.slowest === null ? speed : Math.min(this.slowest, speed);
  }

  report(now = Date.now()): RehearsalReport {
    return {
      minutes: Math.max(0, Math.round((now - this.started) / 60000)),
      problems: [...this.seen.values()],
      dropped: this.dropped,
      slowest: this.slowest,
    };
  }
}

/** Plain words for how it went. */
export function verdict(r: RehearsalReport): { good: boolean; lines: string[] } {
  const lines: string[] = [];
  if (r.dropped > 30)
    lines.push(`The picture missed ${r.dropped} frames: the computer was too busy at times. Turn off some heavy features, or close other programs.`);
  if (r.slowest !== null && r.slowest < 0.95)
    lines.push(
      `At its slowest, the stream kept up at ${Math.round(r.slowest * 100)}% of real time: choose a lower quality, or check the computer isn’t overloaded.`,
    );
  for (const p of r.problems) lines.push(`${p.level === 'error' ? '⚠' : '•'} ${p.title} (after ${Math.max(1, Math.round(p.at / 60000))} min)`);
  return { good: lines.length === 0, lines };
}
