// Chapters from the sequence's markers: written into MP4/MOV files (FFmpeg's
// metadata file) and as the "0:00 Title" list YouTube reads from a description.
import type { Marker } from '../model/types';

export interface Chapter {
  /** Seconds from the start of the export. */
  start: number;
  end: number;
  title: string;
}

/** The chapters in an export of [from, to) (frames): one per marker, the first starting at 0. */
export function chaptersFrom(markers: Marker[], fps: number, range: { from: number; to: number }): Chapter[] {
  const total = (range.to - range.from) / fps;
  if (total <= 0) return [];
  const inside = markers
    .filter((m) => m.at >= range.from && m.at < range.to)
    .sort((a, b) => a.at - b.at)
    .map((m) => ({ start: (m.at - range.from) / fps, title: m.name.trim() }));
  if (!inside.length) return [];
  const starts = inside[0] && inside[0].start > 0.5 ? [{ start: 0, title: 'Start' }, ...inside] : inside.map((c, i) => (i === 0 ? { ...c, start: 0 } : c));
  // Two markers on (nearly) the same frame make one chapter.
  const kept = starts.filter((c, i) => i === 0 || c.start - (starts[i - 1]?.start ?? 0) >= 0.5);
  return kept.map((c, i) => ({ start: c.start, end: kept[i + 1]?.start ?? total, title: c.title || `Chapter ${i + 1}` }));
}

const escape = (s: string): string => s.replace(/[=;#\\\n]/g, (c) => (c === '\n' ? '\\\n' : `\\${c}`));

/** FFmpeg's metadata file with the chapters (milliseconds). */
export function ffmetadata(chapters: Chapter[], title?: string): string {
  const lines = [';FFMETADATA1'];
  if (title) lines.push(`title=${escape(title)}`);
  for (const c of chapters) lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.start * 1000)}`, `END=${Math.round(c.end * 1000)}`, `title=${escape(c.title)}`);
  return `${lines.join('\n')}\n`;
}

const clock = (s: number): string => {
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** The list YouTube turns into chapters (paste it into the description). */
export function youtubeChapters(chapters: Chapter[]): string {
  return chapters.map((c) => `${clock(c.start)} ${c.title}`).join('\n');
}
