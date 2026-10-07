// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addMedia } from '../model/build';
import { current } from '../model/seq';
import { emptyProject, newClip, type MediaItem, type Project } from '../model/types';
import { planDelivery, planStems, reframeHint, thumbnailFor, type DeliveryRequest } from './deliver';
import { loudnessReport, standardFor, stemPath, stemProject, stemsIn, STANDARDS } from './loudness';
import { BUILT_IN, presetProblems, type DeliveryPreset } from './presets';

const preset = (id: string): DeliveryPreset => BUILT_IN.find((x) => x.id === id) as DeliveryPreset;

/** A sequence with speech on A1 (dialogue), music on A2 and a sound effect on A3 (no role). */
function project(): Project {
  const p = emptyProject('Gala');
  const m: MediaItem = {
    id: 'm',
    name: 'Cam',
    path: '/media/cam.mp4',
    proxy: null,
    kind: 'video',
    duration: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
  };
  const withMedia = addMedia({ ...p, media: [m] }, 'm', 0, 'overwrite', undefined, undefined, { in: 0, out: 20 });
  const s = current(withMedia);
  const audio = s.tracks.filter((t) => t.kind === 'audio');
  const tracks = s.tracks.map((t) =>
    t.id === audio[0]?.id ? { ...t, role: 'dialogue' as const } : t.id === audio[1]?.id ? { ...t, role: 'music' as const } : t,
  );
  const music = newClip(audio[1]!.id, 0, 600, { kind: 'media', media: 'm', in: 0 }, 'Music');
  const fx = newClip(audio[2]!.id, 300, 30, { kind: 'media', media: 'm', in: 0 }, 'Door');
  return {
    ...withMedia,
    sequences: [{ ...s, tracks, clips: [...s.clips, music, fx], markers: [{ id: 'k1', at: 150, length: 0, name: 'Speeches', color: '#fff' }] }],
  };
}

const req = (p: Project, over: Partial<DeliveryRequest> = {}): DeliveryRequest => ({
  preset: preset('yt1080'),
  seq: p.open,
  range: { from: 0, to: 600 },
  out: '/films/Gala.mp4',
  chapters: false,
  captions: { burn: true, embed: false, sidecar: false },
  encoders: ['libx264', 'libx265', 'prores_ks', 'png', 'aac', 'libmp3lame'],
  app: true,
  ...over,
});

describe('loudness report', () => {
  it('says on target within 1 LU and under the peak ceiling', () => {
    const r = loudnessReport({ integrated: -14.3, truePeak: -1.4, range: 6.2 }, { lufs: -14, truePeak: -1 });
    expect(r.ok).toBe(true);
    expect(r.line).toBe('Loudness: −14.3 LUFS integrated, −1.4 dBTP true peak, 6.2 LU range (target YouTube, Spotify, streaming −14.0 LUFS: on target).');
    expect(r.advice).toBeNull();
  });

  it('says how far off, and what to do', () => {
    const quiet = loudnessReport({ integrated: -19.6, truePeak: -6, range: 14 }, { lufs: -16, truePeak: -1 });
    expect(quiet.ok).toBe(false);
    expect(quiet.line).toMatch(/Podcasts.*off target/);
    expect(quiet.advice).toMatch(/3\.6 LU quieter/);
    const peaky = loudnessReport({ integrated: -23.2, truePeak: -0.2, range: 9 }, { lufs: -23, truePeak: -1 });
    expect(peaky.ok).toBe(false);
    expect(peaky.advice).toMatch(/limiter/);
    expect(loudnessReport({ integrated: -70, truePeak: -144, range: 0 }, { lufs: -14, truePeak: -1 }).advice).toMatch(/silent/);
  });

  it('just measures when there is no target', () => {
    expect(loudnessReport({ integrated: -20, truePeak: -3, range: 4 }, null)).toEqual({
      ok: true,
      line: 'Loudness: −20.0 LUFS integrated, −3.0 dBTP true peak, 4.0 LU range.',
      advice: null,
    });
  });

  it('knows the standards', () => {
    expect(STANDARDS.map((s) => s.lufs)).toEqual([-14, -16, -23, -24]);
    expect(standardFor(-23)?.name).toMatch(/EBU R128/);
  });
});

describe('stems', () => {
  it('finds dialogue, music and effects by track role', () => {
    const p = project();
    const s = current(p);
    expect(stemsIn(s, { from: 0, to: 600 })).toEqual(['dialogue', 'music', 'effects']);
    expect(stemsIn(s, { from: 400, to: 600 })).toEqual(['dialogue', 'music']);
  });

  it('mutes every other track for a stem', () => {
    const p = project();
    const s = current(stemProject(p, p.open, 'music'));
    const heard = s.tracks.filter((t) => t.kind === 'audio' && !t.off).map((t) => t.role ?? 'none');
    expect(heard).toEqual(['music']);
    // The picture tracks are left alone.
    expect(s.tracks.filter((t) => t.kind === 'video').every((t) => !t.off)).toBe(true);
    expect(stemPath('/films/Gala.mp4', 'dialogue')).toBe('/films/Gala - Dialogue.wav');
  });

  it('plans one WAV a stem, not loudness-matched, next to the film', () => {
    const p = project();
    const plans = planStems(p, req(p));
    expect(plans.map((x) => [x.name, x.plan.settings.out, x.plan.engine, x.plan.settings.loudness])).toEqual([
      ['Dialogue stem', '/films/Gala - Dialogue.wav', 'none', false],
      ['Music stem', '/films/Gala - Music.wav', 'none', false],
      ['Effects stem', '/films/Gala - Effects.wav', 'none', false],
    ]);
    expect(plans[0]!.plan.loudnessTarget).toBeNull();
  });
});

describe('delivery extras', () => {
  it('measures the film against the preset’s target', () => {
    const p = project();
    expect(planDelivery(p, req(p)).loudnessTarget).toEqual({ lufs: -14, truePeak: -1 });
    expect(planDelivery(p, req(p, { preset: preset('master-4444') })).loudnessTarget).toBeNull();
    expect('loudnessTarget' in planDelivery(p, req(p, { preset: preset('png'), out: '/films/Gala.png' }))).toBe(false);
  });

  it('saves a thumbnail from a marker frame', () => {
    const p = project();
    const s = current(p);
    expect(thumbnailFor(req(p, { thumbnailAt: 150 }), s, preset('yt1080'))).toEqual({
      thumbnail: { seconds: 5, width: 1280, out: '/films/Gala - thumbnail.jpg' },
    });
    expect(thumbnailFor(req(p, { thumbnailAt: 150 }), s, preset('shorts')).thumbnail?.width).toBe(1080);
    expect(thumbnailFor(req(p, { thumbnailAt: 700 }), s, preset('yt1080'))).toEqual({});
    expect(thumbnailFor(req(p, { thumbnailAt: 150 }), s, preset('mp3'))).toEqual({});
    expect(planDelivery(p, req(p, { thumbnailAt: 150 })).thumbnail?.seconds).toBe(5);
  });

  it('points vertical and square presets at Auto reframe', () => {
    const p = project();
    const s = current(p);
    expect(reframeHint(p, s.id, preset('yt1080'))).toBeNull();
    expect(reframeHint(p, s.id, preset('shorts'))).toEqual({ aspect: '9:16', ready: null });
    expect(reframeHint(p, s.id, preset('square'))?.aspect).toBe('1:1');
    const reframed = { ...s, id: 'v', name: `${s.name} (9:16)`, width: 1080, height: 1920 };
    expect(reframeHint({ ...p, sequences: [...p.sequences, reframed] }, s.id, preset('tiktok'))?.ready?.id).toBe('v');
  });

  it('new presets are all valid', () => {
    for (const id of ['x', 'linkedin', 'square', 'dnxhr-hqx', 'hevc10-master', 'podcast', 'wav-r128']) expect(presetProblems(preset(id)), id).toEqual([]);
    expect(preset('podcast')).toMatchObject({ loudness: -16, container: 'mp3' });
    expect(preset('wav-r128')).toMatchObject({ loudness: -23, container: 'wav' });
  });
});
