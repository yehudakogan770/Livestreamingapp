/**
 * The FFmpeg graph that makes the sound of [from, to). `firstInput` is the
 * input number of the first part (0, or 1 when the picture is input 0).
 * `speech` is a file with the speech tracks' sound over the same time: pieces
 * that duck are turned down under it.
 */
export function soundGraph(
  parts: Part[],
  seconds: number,
  fps: number,
  from: number,
  firstInput: number,
  loudness: boolean,
  speech: string | null = null,
): SoundGraph {
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  const ducked = speech ? parts.filter((x) => x.duck).length : 0;
  let key = 0;
  parts.forEach((x, i) => {
    const dur = (x.to - x.from) / fps;
    const srcDur = dur * x.speed + 0.2;
    inputs.push('-ss', num(x.srcFrom), '-t', num(srcDur), '-i', x.path);
    const k = firstInput + i;
    const l = Math.min(1, 1 - x.pan) * Math.min(1, 1 - x.track.pan);
    const r = Math.min(1, 1 + x.pan) * Math.min(1, 1 + x.track.pan);
    const chain = [
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      ...(x.reverse ? ['atrim=duration=' + num(srcDur), 'areverse'] : []),
      ...tempo(x.speed),
      `atrim=duration=${num(dur)}`,
      'asetpts=PTS-STARTPTS',
      ...effectChain(x.effects, i),
      `volume='${envelopeExpr(x.envelope)}*${num(dbToGain(x.track.volume))}':eval=frame`,
      ...(Math.abs(l - 1) > 1e-3 || Math.abs(r - 1) > 1e-3 ? [`pan=stereo|c0=${num(l)}*c0|c1=${num(r)}*c1`] : []),
      `adelay=${Math.round(((x.from - from) / fps) * 1000)}:all=1`,
    ];
    const out = `p${i}`;
    if (speech && x.duck) {
      // Turned down while the speech (in the same place in time) is loud.
      filters.push(`[${k}:a]${chain.join(',')}[d${i}]`);
      filters.push(`[d${i}][k${key++}]${duckFilter(x.duck)}[${out}]`);
    } else filters.push(`[${k}:a]${chain.join(',')}[${out}]`);
    labels.push(out);
  });
  if (speech && ducked) {
    inputs.push('-i', speech);
    const keys = Array.from({ length: ducked }, (_, j) => `[k${j}]`).join('');
    const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
    filters.push(`[${firstInput + parts.length}:a]${fmt}${ducked > 1 ? `,asplit=${ducked}` : ''}${keys}`);
  }
  const total = num(seconds);
  const tail = [
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    `apad=whole_dur=${total}`,
    `atrim=duration=${total}`,
    ...(loudness ? ['loudnorm=I=-16:TP=-1.5:LRA=11'] : []),
  ];
  if (labels.length === 0) filters.push(`anullsrc=r=48000:cl=stereo,${tail.join(',')}[aout]`);
  else if (labels.length === 1) filters.push(`[${labels[0]}]${tail.join(',')}[aout]`);
  else
    filters.push(
      `${labels.map((x) => `[${x}]`).join('')}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0,${tail.join(',')}[aout]`,
    );
  return { inputs, graph: filters.join(';') };
}

/** A run of FFmpeg (args may use {tmp} and {out}). */
export interface Job {
  args: string[];
  seconds: number;
}

export type SoundFormat = 'aac' | 'mp3' | 'wav';

/**
 * The runs that make the sound and join it to the picture. When something
 * ducks under speech, the speech tracks are mixed first (the key the
 * ducking listens to). Many pieces of sound are first mixed in groups
 * (FFmpeg works best with fewer files open at once).
 */
export function finishJobs(
  p: Project,
  s: Sequence,
  range: { from: number; to: number },
  video: { file: string; copy: boolean; crf: number } | null,
  sound: SoundFormat,
  loudness: boolean,
): Job[] {
  const fps = rate(s);
  const seconds = (range.to - range.from) / fps;
  let parts = audioParts(p, s, range.from, range.to);
  const jobs: Job[] = [];
  const GROUP = 80;
  let speech: string | null = null;
  const talk = parts.filter((x) => x.track.role === 'dialogue');
  if (talk.length && parts.some((x) => x.duck)) {
    speech = '{tmp}/speech.wav';
    jobs.push(...mixJobs(talk.map((x) => ({ ...x, duck: null })), seconds, fps, range, speech, GROUP));
  }
  if (parts.length > GROUP) {
    const groups: Part[][] = [];
    for (let i = 0; i < parts.length; i += GROUP) groups.push(parts.slice(i, i + GROUP));
    parts = groups.map((g, i) => {
      const file = `{tmp}/mix-${i}.wav`;
      const graph = soundGraph(g, seconds, fps, range.from, 0, false, speech);
      jobs.push({ args: [...graph.inputs, '-filter_complex', graph.graph, '-map', '[aout]', '-c:a', 'pcm_f32le', file], seconds: seconds * 0.3 });
      return premixed(file, g[0]!.track, range);
    });
  }
  const graph = soundGraph(parts, seconds, fps, range.from, video ? 1 : 0, loudness, speech);
  const audioCodec = sound === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : sound === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '256k'];
  const videoArgs = video
    ? [
        '-map',
        '0:v',
        ...(video.copy ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(video.crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high']),
      ]
    : [];
  jobs.push({
    args: [
      ...(video ? ['-i', video.file] : []),
      ...graph.inputs,
      '-filter_complex',
      graph.graph,
      ...videoArgs,
      '-map',
      '[aout]',
      ...audioCodec,
      '-ar',
      '48000',
      ...(video ? ['-movflags', '+faststart', '-t', num(seconds)] : []),
      '{out}',
    ],
    seconds: video && !video.copy ? seconds : seconds * 0.4,
  });
  return jobs;
}

/** A mix already made, as one piece covering the whole range. */
function premixed(file: string, track: Track, range: { from: number; to: number }): Part {
  return {
    path: file,
    track: { ...track, volume: 0, pan: 0 },
    from: range.from,
    to: range.to,
    srcFrom: 0,
    speed: 1,
    reverse: false,
    envelope: [[0, 1]],
    pan: 0,
    effects: [],
    duck: null,
  };
}

/** The runs that mix some pieces into one file (in groups when there are many). */
function mixJobs(parts: Part[], seconds: number, fps: number, range: { from: number; to: number }, file: string, group: number): Job[] {
  const jobs: Job[] = [];
  let list = parts;
  if (list.length > group) {
    const groups: Part[][] = [];
    for (let i = 0; i < list.length; i += group) groups.push(list.slice(i, i + group));
    list = groups.map((g, i) => {
      const f = `${file.replace(/\.wav$/, '')}-${i}.wav`;
      const graph = soundGraph(g, seconds, fps, range.from, 0, false);
      jobs.push({ args: [...graph.inputs, '-filter_complex', graph.graph, '-map', '[aout]', '-c:a', 'pcm_f32le', f], seconds: seconds * 0.3 });
      return premixed(f, g[0]!.track, range);
    });
  }
  const graph = soundGraph(list, seconds, fps, range.from, 0, false);
  jobs.push({ args: [...graph.inputs, '-filter_complex', graph.graph, '-map', '[aout]', '-c:a', 'pcm_f32le', file], seconds: seconds * 0.3 });
  return jobs;
}
