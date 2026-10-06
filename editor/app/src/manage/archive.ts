// Collect files / archive: the project and every file it uses copied into one
// folder (or only the parts used, with handles either side), and a project
// file there that points at the copies.
import { rate, sourceTime } from '../model/seq';
import type { MediaItem, Project } from '../model/types';
import { fileName, joinPath } from '../native';
import type { CollectJob } from './native';

export interface ArchiveOptions {
  /** The folder the archive goes in (a folder named after the project is made inside). */
  folder: string;
  name: string;
  /** Only the parts used (with handles), not whole files. */
  trim: boolean;
  /** Seconds kept before and after each used part. */
  handles: number;
  /** Also files that no sequence uses. */
  includeUnused: boolean;
}

export interface ArchiveItem {
  path: string;
  dest: string;
  /** The part kept (seconds of the original), or null for the whole file. */
  trim: { from: number; to: number } | null;
}

export interface ArchivePlan {
  root: string;
  projectPath: string;
  items: ArchiveItem[];
  jobs: CollectJob[];
  /** The project pointing at the copies. */
  project: Project;
  /** Files that can't be collected (missing). */
  missing: string[];
}

type Range = [number, number];

/** The parts of each file the sequences use (seconds of the file), by media id. */
export function usedRanges(p: Project): Map<string, Range[]> {
  const out = new Map<string, Range[]>();
  const add = (id: string, a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    out.set(id, [...(out.get(id) ?? []), [lo, hi]]);
  };
  for (const s of p.sequences) {
    const fps = rate(s);
    for (const c of s.clips) {
      const src = c.source;
      if (src.kind !== 'media' && src.kind !== 'multicam') continue;
      const t0 = sourceTime(c, 0, fps);
      const t1 = sourceTime(c, c.length - 1, fps);
      const a = Math.min(t0, t1);
      const b = Math.max(t0, t1) + c.speed / fps;
      if (src.kind === 'media') add(src.media, a, b);
      else {
        // Any camera can be switched to later: every angle over the clip's time.
        const g = p.groups.find((x) => x.id === src.group);
        for (const angle of g?.angles ?? []) add(angle.media, a - angle.offset, b - angle.offset);
      }
    }
  }
  return out;
}

/** Ranges joined where they touch or overlap once each has its handles, kept inside [0, duration]. */
export function mergeRanges(ranges: readonly Range[], handles: number, duration: number): Range[] {
  const end = duration > 0 ? duration : Infinity;
  const padded = ranges
    .map(([a, b]) => [Math.max(0, a - handles), Math.min(end, b + handles)] as Range)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of padded) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** The part of a file to keep: from the first used part to the end of the last (null: the whole file is worth keeping). */
export function keepSpan(ranges: readonly Range[], handles: number, duration: number): { from: number; to: number } | null {
  const m = mergeRanges(ranges, handles, duration);
  const first = m[0];
  const last = m[m.length - 1];
  if (!first || !last || !(duration > 0)) return null;
  const span = { from: first[0], to: last[1] };
  // Hardly shorter: the original is copied as it is (no new encode).
  return span.to - span.from > duration * 0.9 ? null : span;
}

const fixed = (n: number): string => Number(n.toFixed(3)).toString();

/** FFmpeg's arguments for a trimmed copy (a high-quality edit-friendly file: frame-accurate, unlike a stream copy). */
export function trimArgs(m: MediaItem, span: { from: number; to: number }): { args: string[]; ext: string } {
  const head = ['-ss', fixed(span.from), '-i', '{in}', '-t', fixed(span.to - span.from)];
  if (!m.hasVideo || m.kind === 'audio') return { args: [...head, '-vn', '-map', '0:a:0', '-c:a', 'pcm_s24le', '{out}'], ext: 'wav' };
  const deep = (m.source?.bitDepth ?? 8) > 8 || /prores|dnxhd|dnxhr/.test(m.source?.codec ?? '');
  const video = deep
    ? ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le']
    : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p'];
  return { args: [...head, '-map', '0:v:0', '-map', '0:a?', ...video, '-c:a', 'pcm_s16le', '{out}'], ext: 'mov' };
}

const safe = (s: string): string => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Project';

/** A name not used yet in the folder (“clip.mp4”, “clip (2).mp4”…). */
function unique(name: string, taken: Set<string>): string {
  let n = name;
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = name.replace(/(\.[^.]+)?$/, (ext) => ` (${i})${ext}`);
  taken.add(n.toLowerCase());
  return n;
}

/** What to copy where, and the project that points at the copies. */
export function archivePlan(p: Project, o: ArchiveOptions): ArchivePlan {
  const root = joinPath(o.folder, safe(o.name));
  const mediaDir = joinPath(root, 'Media');
  const used = usedRanges(p);
  const missing: string[] = [];
  const items: ArchiveItem[] = [];
  const jobs: CollectJob[] = [];
  const taken = new Set<string>();
  // One copy per file, even when several media items (subclips) use it.
  const byPath = new Map<string, MediaItem[]>();
  for (const m of p.media) {
    const inUse = used.has(m.id);
    if (!inUse && !o.includeUnused) continue;
    byPath.set(m.path, [...(byPath.get(m.path) ?? []), m]);
  }
  const moved = new Map<string, { dest: string; offset: number; duration: number | null }>();
  for (const [path, list] of byPath) {
    const m = list[0] as MediaItem;
    const src = m.missing && m.proxy ? m.proxy : path;
    if (m.missing && !m.proxy) {
      missing.push(m.name);
      continue;
    }
    const wholeNeeded = list.some((x) => !used.has(x.id)) || m.kind === 'image' || !(m.duration > 0);
    const ranges = list.flatMap((x) => used.get(x.id) ?? []);
    const span = o.trim && !wholeNeeded ? keepSpan(ranges, o.handles, m.duration) : null;
    let dest: string;
    if (span) {
      const t = trimArgs(m, span);
      dest = joinPath(mediaDir, unique(`${fileName(path).replace(/\.[^.]+$/, '')}.${t.ext}`, taken));
      jobs.push({ from: src, to: dest, args: t.args });
    } else {
      dest = joinPath(mediaDir, unique(fileName(src), taken));
      jobs.push({ from: src, to: dest, args: null });
    }
    items.push({ path, dest, trim: span });
    for (const x of list) moved.set(x.id, { dest, offset: span?.from ?? 0, duration: span ? span.to - span.from : null });
  }
  const project = remap(p, moved, o.includeUnused);
  return { root, projectPath: joinPath(root, `${safe(o.name)}.lumoraedit`), items, jobs, project, missing };
}

/** The project with its media pointing at the copies (times moved for trimmed files). */
function remap(p: Project, moved: Map<string, { dest: string; offset: number; duration: number | null }>, keepUnused: boolean): Project {
  const shift = (id: string) => moved.get(id)?.offset ?? 0;
  return {
    ...p,
    media: p.media
      .filter((m) => keepUnused || moved.has(m.id) || m.missing)
      .map((m) => {
        const mv = moved.get(m.id);
        if (!mv) return m;
        const off = mv.offset;
        const { missing: _gone, playbackProxy: _pp, ...rest } = m;
        const out: MediaItem = { ...rest, path: mv.dest, duration: mv.duration ?? m.duration, proxy: off ? null : m.proxy };
        if (off) {
          if (m.source) out.source = { ...m.source, rotation: 0 };
          if (m.transcript)
            out.transcript = {
              ...m.transcript,
              words: m.transcript.words.filter((w) => w.e > off).map((w) => ({ ...w, s: Math.max(0, w.s - off), e: w.e - off })),
              done: m.transcript.done.map(([a, b]) => [Math.max(0, a - off), Math.max(0, b - off)] as [number, number]).filter(([a, b]) => b > a),
            };
          if (m.range) out.range = [Math.max(0, m.range[0] - off), Math.max(0, m.range[1] - off)];
        }
        return out;
      }),
    groups: p.groups.map((g) => ({ ...g, angles: g.angles.map((a) => (shift(a.media) ? { ...a, offset: a.offset + shift(a.media) } : a)) })),
    sequences: p.sequences.map((s) => ({
      ...s,
      clips: s.clips.map((c) => {
        const src = c.source;
        if (src.kind !== 'media' || !shift(src.media)) return c;
        return { ...c, source: { ...src, in: src.in - shift(src.media) } };
      }),
    })),
  };
}
