import type { EventFile } from './model/event';
import { buildEventProject, type Prepared } from './model/build';
import { newEffect } from './model/effects';
import { TITLE_TEMPLATES } from './model/templates';
import { DEFAULT_TEXT, newClip, type Clip, type Project } from './model/types';

/**
 * A big made-up project for measuring speed in a plain browser (`?big`): a
 * two-hour event filmed with four cameras and the live switch, about 1,500
 * camera cuts, 300 markers, a title every minute, B-roll and effects on every
 * shot (docs/PERFORMANCE.md, Studio). The media are the demo's sample videos
 * (editor/app/public/demo), said to be two hours long.
 */
export function bigProject(opts: { minutes?: number; cuts?: number; markers?: number } = {}): Project {
  const minutes = opts.minutes ?? 120;
  const nCuts = opts.cuts ?? 1500;
  const nMarkers = opts.markers ?? 300;
  const ms = minutes * 60_000;
  const cams = [
    { id: 'wide', name: 'Wide', path: '/demo/wide.webm' },
    { id: 'side', name: 'Stage left', path: '/demo/side.webm' },
    { id: 'close', name: 'Podium close-up', path: '/demo/close.webm' },
    { id: 'aud', name: 'Audience', path: '/demo/wide.webm#aud' },
  ];
  // A steady pseudo-random sequence, so every run measures the same project.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const step = ms / nCuts;
  const event: EventFile = {
    app: 'Lumora',
    version: 1,
    name: 'Big benchmark event',
    startedAt: new Date(2026, 8, 24, 9, 0, 0).getTime(),
    durationMs: ms,
    program: { path: null, mp4: '/demo/live.webm' },
    files: [
      ...cams.map((c) => ({ kind: 'camera' as const, sourceId: c.id, name: c.name, path: c.path, startMs: 0 })),
      { kind: 'microphone' as const, sourceId: 'm1', name: 'Podium mic (sound)', path: '/demo/podium.webm', startMs: 0 },
      { kind: 'microphone' as const, sourceId: 'm2', name: 'Handheld 1 (sound)', path: '/demo/hand.webm', startMs: 0 },
    ],
    // Cuts that always change camera, so none are joined.
    cuts: Array.from({ length: nCuts }, (_, i) => ({ at: Math.round(i * step), id: cams[i % cams.length]!.id, name: cams[i % cams.length]!.name })),
    markers: Array.from({ length: nMarkers }, (_, i) => ({ at: Math.round((i + 0.5) * (ms / nMarkers)), name: `Moment ${i + 1}` })),
  };
  const prep = (path: string, video: boolean, audio: boolean): [string, Prepared] => [
    path,
    { path, durationMs: ms, hasVideo: video, hasAudio: audio, width: video ? 3840 : 0, height: video ? 2160 : 0 },
  ];
  const media = new Map<string, Prepared>([
    prep('/demo/live.webm', true, true),
    ...cams.map((c) => prep(c.path, true, false)),
    prep('/demo/podium.webm', false, true),
    prep('/demo/hand.webm', false, true),
  ]);
  const p = buildEventProject(event, 'C:/Users/You/Videos/Lumora/Big benchmark event.lumora', media);
  const seq = p.sequences[0]!;
  const fps = seq.fps;
  const video = seq.tracks.filter((t) => t.kind === 'video');
  const v2 = video[1]!;
  const v3 = video[2]!;
  // Every camera shot is graded; some have more.
  const extra = ['vignette', 'sharpen', 'blur', 'grain'];
  const clips: Clip[] = seq.clips.map((c, i) =>
    c.source.kind === 'multicam' ? { ...c, effects: [...c.effects, newEffect('basic'), ...(i % 3 === 0 ? [newEffect(extra[i % extra.length]!)] : [])] } : c,
  );
  // A title every minute, on V3.
  const bar = TITLE_TEMPLATES.find((t) => t.id === 'lt-bar')!;
  for (let m = 0; m < minutes; m += 1) {
    const c = newClip(
      v3.id,
      Math.round((m * 60 + 5) * fps),
      Math.round(6 * fps),
      { kind: 'text', text: { ...DEFAULT_TEXT, ...bar.text, text: `Speaker ${m + 1}\nSession title`, accent: '#1f8f99' } },
      `Speaker ${m + 1}`,
    );
    clips.push(c);
  }
  // B-roll on V2: 200 short shots from the cameras, picture in picture.
  const group = p.groups[0]!;
  for (let i = 0; i < 200; i += 1) {
    const at = Math.round(((i + rnd() * 0.5) * ms) / 200 / 1000) * fps;
    const angle = group.angles[1 + (i % (group.angles.length - 1))]!;
    const c = newClip(v2.id, at, Math.round((3 + rnd() * 4) * fps), { kind: 'multicam', group: group.id, angle: angle.id, in: at / fps }, angle.name);
    c.motion = { ...c.motion, scale: 40, x: 520, y: -280 };
    c.effects = [newEffect('basic'), newEffect('shadow')];
    clips.push(c);
  }
  return { ...p, name: 'Big benchmark event', sequences: [{ ...seq, clips, playhead: 0 }] };
}
