import { describe, expect, it } from 'vitest';
import { current } from '../model/seq';
import { emptyProject, newClip, type Project } from '../model/types';
import {
  addBeatMarkers,
  analyzeBeats,
  applyFit,
  buildMontage,
  clipBeatFrames,
  estimateTempo,
  isBeatMarker,
  planFit,
  planLength,
  removeBeatMarkers,
  snapCutsToBeats,
} from './beats';

const RATE = 16000;

/** A click track: a short burst on every beat, the first of each bar louder with a low thump. */
function clicks(bpm: number, seconds: number, offset = 0.5, meter = 4, seed = 7): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let s = seed;
  const noise = () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 30 - 1;
  };
  // Soft background noise all along.
  for (let i = 0; i < out.length; i++) out[i] = noise() * 0.01;
  const period = 60 / bpm;
  for (let k = 0; offset + k * period < seconds - 0.1; k++) {
    const at = Math.round((offset + k * period) * RATE);
    const down = k % meter === 0;
    for (let i = 0; i < 0.04 * RATE && at + i < out.length; i++) {
      const env = Math.exp(-i / (0.008 * RATE));
      const click = noise() * 0.5 * env;
      const thump = down ? Math.sin((2 * Math.PI * 60 * i) / RATE) * 0.9 * Math.exp(-i / (0.03 * RATE)) : 0;
      out[at + i] = (out[at + i] as number) + click * (down ? 1 : 0.6) + thump;
    }
  }
  return out;
}

describe('beat and tempo detection', () => {
  it('finds the tempo, the beats and the bars of a click track', () => {
    const audio = clicks(120, 20, 0.5);
    const b = analyzeBeats(audio, RATE);
    expect(b.bpm).toBeGreaterThan(118.5);
    expect(b.bpm).toBeLessThan(121.5);
    // Every beat within 25 ms of a click.
    const period = 0.5;
    for (const t of b.beats) {
      const k = Math.round((t - 0.5) / period);
      expect(Math.abs(t - (0.5 + k * period))).toBeLessThan(0.025);
    }
    expect(b.beats.length).toBeGreaterThan(35);
    // Bars start on the loud clicks (0.5 s, 2.5 s, 4.5 s…).
    for (const i of b.downbeats.slice(0, 5)) {
      const t = b.beats[i] as number;
      const k = Math.round((t - 0.5) / period);
      expect(k % 4).toBe(0);
    }
  });

  it('other tempos', () => {
    for (const bpm of [90, 140]) {
      const b = analyzeBeats(clicks(bpm, 16, 0.3), RATE);
      expect(Math.abs(b.bpm - bpm)).toBeLessThan(2);
    }
  });

  it('tempo from a plain envelope', () => {
    const env = new Float32Array(2000);
    for (let i = 0; i < env.length; i += 50) env[i] = 1; // 100 steps a second, a pulse every 0.5 s
    expect(estimateTempo(env)).toBeCloseTo(120, 0);
  });
});

describe('fit music to length', () => {
  const bars = Array.from({ length: 30 }, (_, i) => i * 2); // a bar every 2 s, song 60 s

  it('a long song: whole bars come out of the middle, the rest off the start, and it lasts exactly the target', () => {
    const plan = planFit(bars, 60, 45);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(planLength(plan)).toBeCloseTo(45, 6);
    expect(plan.segments.length).toBe(2);
    const [a, b] = plan.segments as [{ from: number; to: number }, { from: number; to: number }];
    // The cut is at bar lines, in the middle part of the song, and the ending is kept.
    expect(a.to % 2).toBeCloseTo(0, 6);
    expect(b.from % 2).toBeCloseTo(0, 6);
    expect(a.to).toBeGreaterThan(60 * 0.15);
    expect(b.from).toBeLessThan(60 * 0.85);
    expect(b.to).toBe(60);
    // Less than a bar comes off the start.
    expect(a.from).toBeLessThan(2);
  });

  it('a short song: bars repeat, and it lasts exactly the target', () => {
    const plan = planFit(bars, 60, 100);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(planLength(plan)).toBeCloseTo(100, 6);
    expect(plan.segments[plan.segments.length - 1]?.to).toBe(60);
    for (const s of plan.segments.slice(1)) expect(s.from % 2).toBeCloseTo(0, 6);
  });

  it('a whole number of bars: nothing comes off the start', () => {
    const plan = planFit(bars, 60, 40);
    expect(plan?.segments[0]?.from).toBe(0);
    expect(planLength(plan!)).toBeCloseTo(40, 6);
  });

  it('replaces the clip with crossfaded parts that end exactly at the frame asked', () => {
    let p: Project = emptyProject('t');
    const s = current(p);
    const a1 = s.tracks.find((t) => t.kind === 'audio')!.id;
    p.media.push({
      id: 'song',
      name: 'song',
      path: '/s.wav',
      proxy: null,
      kind: 'audio',
      duration: 60,
      width: 0,
      height: 0,
      fps: 0,
      hasVideo: false,
      hasAudio: true,
      bin: null,
    });
    const music = newClip(a1, 30, 60 * 30, { kind: 'media', media: 'song', in: 0 }, 'song');
    p = { ...p, sequences: [{ ...s, clips: [music] }] };
    const plan = planFit(bars, 60, 45)!;
    const q = applyFit(p, music.id, plan, 45 * 30);
    const clips = current(q).clips.sort((x, y) => x.start - y.start);
    expect(clips.length).toBe(2);
    expect(clips[0]?.start).toBe(30);
    expect((clips[1]?.start ?? 0) + (clips[1]?.length ?? 0)).toBe(30 + 45 * 30);
    expect(clips[1]?.tIn?.type).toBe('crossfade');
    expect(clips[0]?.start! + clips[0]?.length!).toBe(clips[1]?.start);
  });
});

describe('on the timeline', () => {
  const setup = () => {
    let p: Project = emptyProject('t');
    const s = current(p);
    const v1 = s.tracks.find((t) => t.kind === 'video')!.id;
    const a1 = s.tracks.find((t) => t.kind === 'audio')!.id;
    p.media.push(
      {
        id: 'song',
        name: 'song',
        path: '/s.wav',
        proxy: null,
        kind: 'audio',
        duration: 60,
        width: 0,
        height: 0,
        fps: 0,
        hasVideo: false,
        hasAudio: true,
        bin: null,
      },
      {
        id: 'cam',
        name: 'cam',
        path: '/c.mp4',
        proxy: null,
        kind: 'video',
        duration: 120,
        width: 1920,
        height: 1080,
        fps: 30,
        hasVideo: true,
        hasAudio: false,
        bin: null,
      },
    );
    const music = newClip(a1, 0, 20 * 30, { kind: 'media', media: 'song', in: 0 }, 'song');
    const c1 = newClip(v1, 0, 47, { kind: 'media', media: 'cam', in: 10 }, 'one');
    const c2 = newClip(v1, 47, 70, { kind: 'media', media: 'cam', in: 30 }, 'two');
    p = { ...p, sequences: [{ ...s, clips: [music, c1, c2] }] };
    const beats = { bpm: 120, beats: Array.from({ length: 40 }, (_, i) => i * 0.5), downbeats: [0, 4, 8, 12, 16, 20, 24, 28, 32, 36], meter: 4 };
    return { p, music, c1, c2, beats };
  };

  it('beat markers, bars only, and removing them', () => {
    const { p, music, beats } = setup();
    const { project, count } = addBeatMarkers(p, music.id, beats, true);
    expect(count).toBe(10);
    expect(current(project).markers.every(isBeatMarker)).toBe(true);
    expect(current(project).markers[1]?.at).toBe(60);
    expect(current(removeBeatMarkers(project)).markers.length).toBe(0);
  });

  it('snaps a cut to the nearest beat (rolled: the next clip starts there too)', () => {
    const { p, music, c1, beats } = setup();
    const frames = clipBeatFrames(music, beats, 30).map((x) => x.frame);
    const { project, moved } = snapCutsToBeats(p, [c1.id], frames, 5);
    expect(moved).toBe(1);
    const s = current(project);
    const one = s.clips.find((c) => c.id === c1.id)!;
    expect(one.start + one.length).toBe(45);
    expect(s.clips.find((c) => c.name === 'two')?.start).toBe(45);
  });

  it('a montage cut every bar', () => {
    const { p, music, c1, c2, beats } = setup();
    const made = buildMontage(p, music, [c1, c2], beats, 4);
    expect(made).not.toBeNull();
    const s = current(made!.project);
    expect(s.id).toBe(made!.seq);
    const pics = s.clips.filter((c) => s.tracks.find((t) => t.id === c.track)?.kind === 'video').sort((a, b) => a.start - b.start);
    // A cut every 2 s (60 frames), alternating between the two pictures.
    expect(pics.map((c) => c.start).slice(0, 4)).toEqual([0, 60, 120, 180]);
    expect(pics[0]?.name).toBe('one');
    expect(pics[1]?.name).toBe('two');
  });
});
