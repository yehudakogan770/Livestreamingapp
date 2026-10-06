import type { EventFile } from './model/event';
import { buildEventProject, mediaFrom, type Prepared } from './model/build';
import { newGradeEffect, newNode, type Grade } from './model/grade';
import { TITLE_TEMPLATES } from './model/templates';
import { DEFAULT_TEXT, newClip, newTrack, type Project, type Track } from './model/types';

/**
 * A made-up event for trying the screens in a plain browser (`?demo`): a
 * conference keynote filmed with four cameras, with sample videos in
 * editor/app/public/demo (not part of the program; e2e/make-media.mjs makes
 * stand-ins with the same names).
 */
export async function demoProject(): Promise<Project> {
  const event: EventFile = {
    app: 'Lumora',
    version: 1,
    name: 'Northwind Summit 2026',
    startedAt: new Date(2026, 8, 24, 19, 30, 0).getTime(),
    durationMs: 120_000,
    program: { path: null, mp4: '/demo/live.webm' },
    files: [
      { kind: 'camera', sourceId: 'wide', name: 'Wide', path: '/demo/wide.webm', startMs: 0 },
      { kind: 'camera', sourceId: 'stage', name: 'Stage left', path: '/demo/stage.webm', startMs: 0 },
      { kind: 'camera', sourceId: 'close', name: 'Podium close-up', path: '/demo/closeup.webm', startMs: 0 },
      { kind: 'camera', sourceId: 'aud', name: 'Audience', path: '/demo/audience.webm', startMs: 0 },
      { kind: 'microphone', sourceId: 'm1', name: 'Podium mic (sound)', path: '/demo/podium.webm', startMs: 0 },
      { kind: 'microphone', sourceId: 'm2', name: 'Handheld 1 (sound)', path: '/demo/hand.webm', startMs: 0 },
      { kind: 'microphone', sourceId: 'm3', name: 'Room (sound)', path: '/demo/room.webm', startMs: 0 },
    ],
    cuts: [
      { at: 0, id: 'wide', name: 'Wide' },
      { at: 6000, id: 'close', name: 'Podium close-up' },
      { at: 18_000, id: 'slides', name: 'Keynote slides' },
      { at: 26_000, id: 'stage', name: 'Stage left' },
      { at: 37_000, id: 'close', name: 'Podium close-up' },
      { at: 52_000, id: 'aud', name: 'Audience' },
      { at: 58_000, id: 'close', name: 'Podium close-up' },
      { at: 74_000, id: 'wide', name: 'Wide' },
      { at: 84_000, id: 'stage', name: 'Stage left' },
      { at: 96_000, id: 'aud', name: 'Audience' },
      { at: 104_000, id: 'wide', name: 'Wide' },
    ],
    markers: [
      { at: 6000, name: 'Keynote starts' },
      { at: 26_000, name: 'Product demo' },
      { at: 49_000, name: 'Applause' },
      { at: 96_000, name: 'Q&A' },
      { at: 114_000, name: 'Thank you' },
    ],
  };
  const m = (path: string, durationMs: number, video: boolean, audio: boolean): [string, Prepared] => [
    path,
    { path, durationMs, hasVideo: video, hasAudio: audio, width: video ? 1280 : 0, height: video ? 720 : 0 },
  ];
  const media = new Map<string, Prepared>([
    m('/demo/live.webm', 120_000, true, true),
    m('/demo/wide.webm', 120_000, true, false),
    m('/demo/stage.webm', 120_000, true, false),
    m('/demo/closeup.webm', 120_000, true, false),
    m('/demo/audience.webm', 120_000, true, false),
    m('/demo/podium.webm', 120_000, false, true),
    m('/demo/hand.webm', 120_000, false, true),
    m('/demo/room.webm', 120_000, false, true),
  ]);
  const p = buildEventProject(event, 'C:/Users/You/Videos/Lumora/Northwind Summit 2026.lumora', media);
  // Some media of its own, as if imported.
  const bin = { id: 'b-extra', name: 'Music & pictures', parent: null };
  const music = {
    ...mediaFrom({ path: '/demo/music.webm', durationMs: 120_000, hasVideo: false, hasAudio: true, width: 0, height: 0 }, 'Walk-in music', bin.id),
    id: 'm-music',
  };
  const logo = {
    ...mediaFrom({ path: '/brand/lumora-logo.svg', durationMs: 0, hasVideo: true, hasAudio: false, width: 600, height: 160 }, 'Logo', bin.id),
    kind: 'image' as const,
    id: 'm-logo',
  };

  // The edit so far: the speaker's name title, the music under the opening and
  // the close, and a grade on the cameras.
  const seq = p.sequences[0]!;
  const fps = seq.fps;
  const v2 = seq.tracks.filter((t) => t.kind === 'video')[1]!;
  const bar = TITLE_TEMPLATES.find((t) => t.id === 'lt-bar')!;
  const name = (from: number, to: number) => {
    const c = newClip(
      v2.id,
      Math.round(from * fps),
      Math.round((to - from) * fps),
      { kind: 'text', text: { ...DEFAULT_TEXT, ...bar.text, text: 'Daniel Brooks\nChief Product Officer', accent: '#1f8f99' } },
      'Daniel Brooks',
    );
    return c;
  };
  const musicTrack: Track = { ...newTrack('audio', seq.tracks.filter((t) => t.kind === 'audio').length + 1), name: 'Music', role: 'music' };
  const bed = newClip(musicTrack.id, 0, Math.round(120 * fps), { kind: 'media', media: music.id, in: 0 }, music.name);
  bed.gain = -14;
  const grade: Grade = {
    steps: [
      { kind: 'serial', node: { ...newNode('Balance'), p: { exposure: 0.15, temperature: -6, contrast: 12, shadows: 10 } } },
      {
        kind: 'serial',
        node: {
          ...newNode('Look'),
          p: { saturation: 118, liftX: -0.06, liftY: -0.08, lift: -4, gainX: 0.05, gainY: 0.04, gain: 6 },
          curves: {
            master: [
              [0, 0],
              [0.25, 0.21],
              [0.75, 0.8],
              [1, 1],
            ],
            r: [
              [0, 0],
              [1, 1],
            ],
            g: [
              [0, 0],
              [1, 1],
            ],
            b: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      },
    ],
  };
  const clips = seq.clips.map((c) =>
    c.source.kind === 'multicam' && c.source.angle !== 'live' ? { ...c, effects: [...c.effects, newGradeEffect(structuredClone(grade))] } : c,
  );
  const tracks = [...seq.tracks, musicTrack];
  return {
    ...p,
    bins: [...p.bins, bin],
    media: [...p.media, music, logo],
    sequences: [{ ...seq, tracks, clips: [...clips, name(7, 15), name(59, 66), bed], playhead: Math.round(9 * fps) }],
  };
}
