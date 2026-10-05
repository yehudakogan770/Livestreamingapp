import { ffmpegLook } from './color';
import { heardTracks, layout, placedTitles, type Angle, type Project, type Track } from './project';

/** How the film is made. */
export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  /** x264 quality (lower is better and bigger). */
  crf: number;
  preset: 'veryfast' | 'faster' | 'medium' | 'slow';
  /** Even out the loudness the way YouTube and Facebook like it. */
  loudness: boolean;
  /** Sound only (no picture). */
  audio: 'aac' | 'mp3' | 'wav' | null;
  /** Only the marked part. */
  rangeOnly: boolean;
}

/** One FFmpeg run. `{tmp}` is the work folder and `{out}` the finished file. */
export interface Job {
  args: string[];
  /** How long the part it makes is (for the progress bar). */
  seconds: number;
}

export interface Plan {
  jobs: Job[];
  /** The list of parts, joined into the finished file. */
  list: string;
  final: Job;
  /** Titles to draw into `{tmp}/title-<id>.png` first. */
  titles: string[];
  seconds: number;
}

/** A part of the film: one camera, or a dissolve from one to another. */
export interface Piece {
  /** Film time it starts (ms), and how long it is. */
  at: number;
  length: number;
  a: { angle: string; from: number };
  /** For a dissolve: what it dissolves into, and how long the whole dissolve is. */
  b?: { angle: string; from: number; fade: number };
  /** For a dissolve cut short by the marked part: how much of the start is left out. */
  skip: number;
}

/** The film as parts, on whole frames, cut to the marked part when asked. */
export function pieces(p: Project, fps: number, range: { from: number; to: number } | null): Piece[] {
  const frame = (ms: number) => (Math.round((ms * fps) / 1000) * 1000) / fps;
  const { starts } = layout(p.clips);
  const raw: Piece[] = [];
  p.clips.forEach((c, i) => {
    const start = starts[i] ?? 0;
    const len = c.out - c.in;
    const next = p.clips[i + 1];
    const fadeIn = i > 0 ? c.fade : 0;
    const fadeOut = next ? next.fade : 0;
    const prev = p.clips[i - 1];
    if (prev && fadeIn > 0) {
      const from = frame(start - fadeIn / 2);
      const to = frame(start + fadeIn / 2);
      raw.push({
        at: from,
        length: to - from,
        a: { angle: prev.angle, from: prev.out - (start - from) },
        b: { angle: c.angle, from: c.in - (start - from), fade: to - from },
        skip: 0,
      });
    }
    const from = frame(start + fadeIn / 2);
    const to = frame(start + len - fadeOut / 2);
    if (to - from > 0) raw.push({ at: from, length: to - from, a: { angle: c.angle, from: c.in + (from - start) }, skip: 0 });
  });
  if (!range) return raw;
  const r0 = frame(range.from);
  const r1 = frame(range.to);
  return raw.flatMap((x) => {
    const s = Math.max(x.at, r0);
    const e = Math.min(x.at + x.length, r1);
    if (e - s <= 0) return [];
    const cut = s - x.at;
    if (x.b) return [{ ...x, at: s, length: e - s, skip: x.skip + cut }];
    return [{ ...x, at: s, length: e - s, a: { ...x.a, from: x.a.from + cut } }];
  });
}

const sec = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);

/** Where a moment of the event is in a recording's own file. */
function within(m: { startMs: number; offsetMs: number; durationMs: number }, from: number, length: number) {
  const fileFrom = from - m.startMs - m.offsetMs;
  if (fileFrom + length <= 0 || fileFrom >= m.durationMs) return null;
  return { seek: Math.max(0, fileFrom), lead: Math.max(0, -fileFrom) };
}

class Graph {
  inputs: string[] = [];
  filters: string[] = [];
  private n = 0;
  label(prefix: string) {
    this.n += 1;
    return `${prefix}${this.n}`;
  }
  input(args: string[]): number {
    this.inputs.push(...args);
    return this.inputs.filter((x) => x === '-i').length - 1;
  }
}

function video(g: Graph, angle: Angle | undefined, from: number, length: number, o: ExportOptions): string {
  const out = g.label('v');
  const w = within(angle ?? { startMs: 0, offsetMs: 0, durationMs: 0 }, from, length);
  if (!angle || !w) {
    g.filters.push(`color=c=black:s=${o.width}x${o.height}:r=${o.fps}:d=${sec(length)},format=yuv420p[${out}]`);
    return out;
  }
  const k = g.input(['-ss', sec(w.seek), '-t', sec(length - w.lead + 500), '-i', angle.path]);
  const look = ffmpegLook(angle.look);
  const chain = [
    'setpts=PTS-STARTPTS',
    `fps=${o.fps}`,
    `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease`,
    `pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    ...(look ? [look] : []),
    'format=yuv420p',
    ...(w.lead > 0 ? [`tpad=start_duration=${sec(w.lead)}:color=black`] : []),
    `tpad=stop_mode=add:stop_duration=${sec(length)}:color=black`,
    `trim=duration=${sec(length)}`,
    'setpts=PTS-STARTPTS',
  ];
  g.filters.push(`[${k}:v]${chain.join(',')}[${out}]`);
  return out;
}

function sound(g: Graph, tracks: Track[], from: number, length: number): string {
  const parts: string[] = [];
  for (const t of tracks) {
    const w = within(t, from, length);
    if (!w) continue;
    const k = g.input(['-ss', sec(w.seek), '-t', sec(length - w.lead + 500), '-i', t.path]);
    const out = g.label('a');
    const chain = [
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      ...(w.lead > 0 ? [`adelay=${Math.round(w.lead)}:all=1`] : []),
      'apad',
      `atrim=duration=${sec(length)}`,
      'asetpts=PTS-STARTPTS',
      ...(t.gainDb !== 0 ? [`volume=${t.gainDb.toFixed(1)}dB`] : []),
    ];
    g.filters.push(`[${k}:a]${chain.join(',')}[${out}]`);
    parts.push(out);
  }
  const out = g.label('m');
  if (parts.length === 0) g.filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${sec(length)}[${out}]`);
  else if (parts.length === 1) g.filters.push(`[${parts[0]}]anull[${out}]`);
  else g.filters.push(`${parts.map((x) => `[${x}]`).join('')}amix=inputs=${parts.length}:duration=longest:normalize=0[${out}]`);
  return out;
}

/** The FFmpeg run that makes one part of the film. */
export function pieceJob(p: Project, piece: Piece, file: string, o: ExportOptions): Job {
  const g = new Graph();
  const angle = (id: string) => p.angles.find((a) => a.id === id);
  const tracks = heardTracks(p);
  // A dissolve is made whole, then cut down to what's wanted.
  const whole = piece.b ? piece.b.fade : piece.length;
  const origin = piece.at - piece.skip;
  let v = '';
  let a: string;
  if (piece.b) {
    const fade = piece.b.fade;
    if (!o.audio) {
      const va = video(g, angle(piece.a.angle), piece.a.from, fade, o);
      const vb = video(g, angle(piece.b.angle), piece.b.from, fade, o);
      v = g.label('x');
      g.filters.push(`[${va}][${vb}]xfade=transition=fade:duration=${sec(fade)}:offset=0[${v}]`);
    }
    const sa = sound(g, tracks, piece.a.from, fade);
    const sb = sound(g, tracks, piece.b.from, fade);
    a = g.label('x');
    // The same sound on both sides (a camera change) stays the same.
    g.filters.push(`[${sa}][${sb}]acrossfade=d=${sec(fade)}:c1=tri:c2=tri[${a}]`);
  } else {
    if (!o.audio) v = video(g, angle(piece.a.angle), piece.a.from, piece.length, o);
    a = sound(g, tracks, piece.a.from, piece.length);
  }
  if (!o.audio) {
    for (const { title, start } of placedTitles(p)) {
      const t0 = start - origin;
      const t1 = t0 + title.length;
      if (t1 <= piece.skip || t0 >= piece.skip + piece.length) continue;
      const k = g.input(['-loop', '1', '-framerate', String(o.fps), '-t', sec(whole), '-i', `{tmp}/title-${title.id}.png`]);
      const fades = [...(t0 >= 0 ? [`fade=t=in:st=${sec(t0)}:d=0.4:alpha=1`] : []), ...(t1 <= whole ? [`fade=t=out:st=${sec(t1 - 400)}:d=0.4:alpha=1`] : [])];
      const tl = g.label('t');
      g.filters.push(`[${k}:v]${['format=yuva420p', ...fades].join(',')}[${tl}]`);
      const next = g.label('o');
      g.filters.push(`[${v}][${tl}]overlay=0:0:enable='between(t,${sec(t0)},${sec(t1)})':eof_action=pass,format=yuv420p[${next}]`);
      v = next;
    }
  }
  if (piece.skip > 0) {
    if (!o.audio) {
      const cut = g.label('c');
      g.filters.push(`[${v}]trim=start=${sec(piece.skip)}:duration=${sec(piece.length)},setpts=PTS-STARTPTS[${cut}]`);
      v = cut;
    }
    const cutA = g.label('c');
    g.filters.push(`[${a}]atrim=start=${sec(piece.skip)}:duration=${sec(piece.length)},asetpts=PTS-STARTPTS[${cutA}]`);
    a = cutA;
  }
  const encode = o.audio
    ? ['-map', `[${a}]`]
    : [
        '-map',
        `[${v}]`,
        '-map',
        `[${a}]`,
        '-c:v',
        'libx264',
        '-preset',
        o.preset,
        '-crf',
        String(o.crf),
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'high',
        '-r',
        String(o.fps),
        '-g',
        String(o.fps * 2),
      ];
  return {
    args: [
      ...g.inputs,
      '-filter_complex',
      g.filters.join(';'),
      ...encode,
      '-c:a',
      'pcm_s16le',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-t',
      sec(piece.length),
      '-f',
      'matroska',
      `{tmp}/${file}`,
    ],
    seconds: piece.length / 1000,
  };
}

/** Everything to run to make the film. */
export function makePlan(p: Project, o: ExportOptions): Plan {
  const range = o.rangeOnly && p.range ? p.range : null;
  const list = pieces(p, o.fps, range);
  if (list.length === 0) throw new Error('There is nothing to export: the film is empty.');
  const jobs = list.map((piece, i) => pieceJob(p, piece, `part-${String(i + 1).padStart(4, '0')}.mkv`, o));
  const seconds = list.reduce((s, x) => s + x.length, 0) / 1000;
  const audio = o.audio === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : o.audio === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k'];
  const final: Job = {
    args: [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      '{tmp}/list.txt',
      ...(o.audio ? ['-vn'] : ['-map', '0:v', '-c:v', 'copy']),
      '-map',
      '0:a',
      ...(o.loudness ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'] : []),
      ...audio,
      '-ar',
      '48000',
      ...(o.audio ? [] : ['-movflags', '+faststart']),
      '{out}',
    ],
    seconds,
  };
  return {
    jobs,
    list: list.map((_, i) => `file 'part-${String(i + 1).padStart(4, '0')}.mkv'`).join('\n') + '\n',
    final,
    titles: o.audio ? [] : placedTitles(p).map((x) => x.title.id),
    seconds,
  };
}
