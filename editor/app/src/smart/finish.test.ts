import { describe, expect, it, vi } from 'vitest';
import { isChapterMarker } from '../extras/chapters';
import { current } from '../model/seq';
import { emptyProject, type MediaItem, type Project } from '../model/types';
import { detectSpeakers } from './autocam';
import { finishEvent, FINISH_DEFAULTS, type FinishServices } from './finish';
import { buildMulticam } from './syncsound';

const TOPICS = [
  ['budget', 'money', 'costs', 'spending', 'savings'],
  ['garden', 'flowers', 'trees', 'soil', 'planting'],
  ['music', 'songs', 'choir', 'singing', 'piano'],
];

/** A ten-minute event filmed by two cameras; camera A's sound has the talk on three topics. */
function event(): Project {
  const words: { w: string; s: number; e: number }[] = [];
  for (let t = 0; t < 600; t += 4) {
    const topic = TOPICS[Math.min(2, Math.floor(t / 200))]!;
    const line = ['We', 'talked', 'about', topic[(t / 4) % 5]!, `${topic[(t / 4 + 2) % 5]!}.`];
    line.forEach((w, i) => words.push({ w, s: t + i * 0.6, e: t + i * 0.6 + 0.5 }));
  }
  const cam = (id: string, transcript: boolean): MediaItem => ({
    id,
    name: id,
    path: `/${id}.mp4`,
    proxy: null,
    kind: 'video',
    duration: 600,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
    ...(transcript ? { transcript: { language: 'en', model: 'test', words, done: [[0, 600]] as [number, number][] } } : {}),
  });
  const a = cam('Stage', true);
  const b = cam('Podium', false);
  const p = { ...emptyProject('Gala'), media: [a, b] };
  return buildMulticam(p, {
    name: 'Gala',
    files: [
      { media: a, offset: 0 },
      { media: b, offset: 0 },
    ],
    sound: ['Stage'],
  }).project;
}

function services(): FinishServices & { framed: number; transcribed: number } {
  const svc = {
    framed: 0,
    transcribed: 0,
    micLevels: async (_p: Project, _s: unknown, _g: unknown, mics: { media: string }[], hop: number) =>
      // Each microphone loud in turn, 30 seconds each.
      mics.map((_, k) => {
        const env = new Float32Array(Math.round(600 / hop)).fill(-60);
        for (let i = 0; i < env.length; i++) if (Math.floor((i * hop) / 30) % mics.length === k) env[i] = -20;
        return env;
      }),
    speakers: (envs: Float32Array[]) => detectSpeakers(envs),
    levels: async (_p: Project, _s: unknown, hop: number) => {
      const a = new Float32Array(Math.round(600 / hop)).fill(-30);
      a.fill(-8, Math.round(300 / hop), Math.round(305 / hop));
      return a;
    },
    transcribe: async (p: Project) => {
      svc.transcribed++;
      return p;
    },
    frame: async (p: Project) => {
      svc.framed++;
      return p;
    },
  };
  return svc;
}

const job = { signal: new AbortController().signal, progress: vi.fn() };

describe('Finish the event', () => {
  it('cuts the cameras, captions, chapters, a reel and clips, as one result with the event still open', async () => {
    const p = event();
    const svc = services();
    const r = await finishEvent(p, { ...FINISH_DEFAULTS, clips: 3 }, svc, job);
    expect(r.skipped).toEqual([]);
    const film = r.project.sequences.find((s) => s.id === r.film)!;
    expect(r.project.open).toBe(r.film);
    // Cut: the multicam clip is now many shots, switching between the two cameras.
    const shots = film.clips.filter((c) => c.source.kind === 'multicam');
    expect(shots.length).toBeGreaterThan(5);
    expect(new Set(shots.map((c) => (c.source.kind === 'multicam' ? c.source.angle : ''))).size).toBe(2);
    // Already transcribed: not done again.
    expect(svc.transcribed).toBe(0);
    expect(film.clips.filter((c) => c.source.kind === 'caption').length).toBeGreaterThan(20);
    expect(film.markers.filter(isChapterMarker).length).toBeGreaterThanOrEqual(2);
    // The reel and three vertical clips, each framed.
    expect(r.reel).not.toBeNull();
    expect(r.clips).toHaveLength(3);
    expect(svc.framed).toBe(3);
    for (const id of r.clips) {
      const s = r.project.sequences.find((x) => x.id === id)!;
      expect(s.height).toBeGreaterThan(s.width);
      expect(s.tracks.find((t) => t.captions)?.captions?.anim).toBe('highlight');
    }
    expect(r.done).toHaveLength(5);
    // Nothing in the original project changed (it is one change, applied by the caller).
    expect(current(p).clips.filter((c) => c.source.kind === 'multicam')).toHaveLength(1);
  });

  it('says why a step was skipped', async () => {
    const p = { ...emptyProject('Empty') };
    const r = await finishEvent(p, { ...FINISH_DEFAULTS, transcribe: false }, services(), job);
    expect(r.skipped.join(' ')).toMatch(/no multicam clip/);
    expect(r.skipped.join(' ')).toMatch(/nothing was heard/);
  });
});
