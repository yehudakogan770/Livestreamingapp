import { describe, expect, it } from 'vitest';
import { demoApply, demoTick } from '../engine/demo';
import { emptyShow } from '../engine/client';
import { defaultVisuals } from '../engine/visuals';
import { BANKS, PALETTES } from './data';
import { beatAt, defaultFx, fadeMix, logoRect, VisualsPlayer } from './player';
import { SCENE_MODES, sceneShader } from './renderer';
import { SCENE_FS } from './shaders';

describe('stage visuals', () => {
  it('has every music type and scene, each with a color set that exists', () => {
    expect(BANKS).toHaveLength(13);
    expect(BANKS.reduce((n, b) => n + b.scenes.length, 0)).toBe(261);
    for (const b of BANKS) for (const s of b.scenes) expect(PALETTES[s[2]], `${b.name} · ${s[0]}`).toBeDefined();
  });

  it('keeps the beat from the anchor', () => {
    const v = { ...defaultVisuals(), bpm: 120, anchorAt: 1000, anchorBeat: 4 };
    expect(beatAt(v, 2000)).toBe(6);
  });

  it('waits for the next beat, then fades over the music type’s fade', () => {
    let s = emptyShow();
    s = demoApply(s, { type: 'visualsTempo', bpm: 120 }, 0);
    s = demoApply(s, { type: 'visualsScene', scene: { bank: 1, scene: 2 } }, 1200);
    const v = s.visuals;
    expect(v.from).toEqual({ bank: 1, scene: 0 });
    expect(v.fadeStart).toBe(3);
    expect(fadeMix(v, 2.9)).toBe(0);
    expect(fadeMix(v, 3 + v.fadeLen / 2)).toBeCloseTo(0.5);
    expect(fadeMix(v, 99)).toBe(1);
  });

  it('changes scene by itself on autopilot (like the engine)', () => {
    let s = emptyShow();
    s = demoApply(s, { type: 'visualsTempo', bpm: 120 }, 0);
    s = demoApply(s, { type: 'updateVisuals', patch: { settings: { ...s.visuals.settings, autoBars: 2 } } }, 1000);
    expect(s.visuals.nextAuto).toBe(8);
    expect(demoTick(s, 3900)).toBeNull();
    const next = demoTick(s, 4000)!;
    expect(next.visuals.scene.scene).toBe(1);
    expect(next.visuals.nextAuto).toBe(16);
  });

  it('safe mode keeps the strobe off', () => {
    let s = emptyShow();
    s = demoApply(s, { type: 'updateVisuals', patch: { strobe: true } }, 0);
    expect(s.visuals.strobe).toBe(false);
  });

  it('refuses a scene that does not exist and an empty look', () => {
    const s = emptyShow();
    expect(() => demoApply(s, { type: 'visualsScene', scene: { bank: 40, scene: 0 } }, 0)).toThrow();
    expect(() => demoApply(s, { type: 'visualsLook', slot: 0, store: false }, 0)).toThrow();
    const kept = demoApply(s, { type: 'visualsLook', slot: 0, store: true }, 0);
    expect(kept.visuals.looks[0]?.scene).toEqual(s.visuals.scene);
  });

  it('builds each scene program with only the scenes on (cut from the full shader)', () => {
    // Every scene in the music types has its own block, except star drift (19), the last "else" one.
    const used = [...new Set(BANKS.flatMap((b) => b.scenes.map((s) => s[1])))];
    expect(used.filter((m) => !SCENE_MODES.includes(m))).toEqual([19]);
    expect(sceneShader(19, -1, -1)).toContain('// star drift');
    // One scene: one block, no long chain, no scene(uM…) calls left.
    const one = sceneShader(3, -1, -1);
    expect(one).toContain('const int m=3;');
    expect(one).toContain('// spiral');
    expect(one).not.toContain('// neon rings');
    expect(one).not.toContain('scene(uM');
    expect(one.length).toBeLessThan(SCENE_FS.length / 3);
    // Fading and an overlay: three layers.
    const three = sceneShader(0, 3, 5);
    for (const name of ['// neon rings', '// spiral', '// hex tunnel']) expect(three).toContain(name);
  });

  it('a new scene starts with its own look; a saved look brings back its own (like the engine)', () => {
    let s = emptyShow();
    const fx = { ...defaultFx(), zoom: 2, kal: 6, ov: 0.4, ovScene: { bank: 2, scene: 3 } };
    s = demoApply(s, { type: 'updateVisuals', patch: { fx, settings: { ...s.visuals.settings, speed: 1.5 } } }, 0);
    s = demoApply(s, { type: 'visualsLook', slot: 0, store: true }, 0);
    const first = s.visuals.scene;
    s = demoApply(s, { type: 'visualsScene', scene: { bank: 1, scene: 4 } }, 0);
    expect(s.visuals.fx).toEqual({ ...defaultFx(), ov: 0.4, ovMode: fx.ovMode, ovScene: { bank: 2, scene: 3 } });
    expect(s.visuals.settings.speed).toBe(1.5);
    s = demoApply(s, { type: 'visualsLook', slot: 0, store: false }, 4000);
    expect(s.visuals.scene).toEqual(first);
    expect(s.visuals.fx.kal).toBe(6);
  });

  it('builds frames with every number set', () => {
    const p = new VisualsPlayer();
    const v = { ...defaultVisuals(), bpm: 128, from: { bank: 0, scene: 3 }, fadeStart: 1, fadeLen: 2 };
    for (const t of [0, 16, 500, 1000, 5000]) {
      const u = p.frame(v, t);
      for (const [k, x] of Object.entries(u)) if (typeof x === 'number') expect(Number.isFinite(x), k).toBe(true);
      expect(u.p0).toHaveLength(9);
    }
  });

  it('puts the logo in the corner, inside the frame', () => {
    const r = logoRect({ on: true, place: 'corner', size: 0.2, pulse: 0 }, 0, 1920, 1080, 2);
    expect(r.x + r.w).toBeLessThanOrEqual(1920);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.h).toBeCloseTo(216);
  });
});
