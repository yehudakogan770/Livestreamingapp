import { describe, expect, it } from 'vitest';
import { EFFECTS, newEffect } from '../model/effects';
import { MORE_EFFECTS, moreEffectUniforms } from './fxlib';
import { EFFECT_FS } from './shaders';

/** The loose uniforms a program declares (the shared header's texture and size aside). */
function declared(fs: string): string[] {
  const out: string[] = [];
  for (const m of fs.matchAll(/uniform\s+(?:float|int|vec2|vec3|vec4|mat3)\s+([^;]+);/g))
    for (const name of (m[1] as string).split(',').map((x) => x.trim())) if (name !== 'uSize') out.push(name);
  return out;
}

describe('more picture effects', () => {
  it('are in the effects list with a program each, given every number it asks for', () => {
    for (const def of MORE_EFFECTS) {
      expect(EFFECTS.some((e) => e.type === def.type)).toBe(true);
      const fs = EFFECT_FS[def.type];
      expect(fs, def.type).toBeTruthy();
      const e = newEffect(def.type);
      const n = (k: string, d = 0) => (Number.isFinite(e.p[k]) ? (e.p[k] as number) : d);
      const u = moreEffectUniforms(def.type, n, { k: 1, time: 1.5, d: e.d ?? {} });
      expect(u, def.type).not.toBeNull();
      if (u === 'skip' || u === null) continue;
      expect(Object.keys(u).sort(), def.type).toEqual(declared(fs as string).sort());
      for (const v of Object.values(u)) for (const x of [v].flat()) expect(Number.isFinite(x), def.type).toBe(true);
    }
  });

  it('do nothing (and cost nothing) when set to nothing', () => {
    const zero = (k: string) => (k === 'amount' || k === 'blur' ? 0 : 1);
    for (const t of ['vdenoise', 'skin', 'clarity', 'tiltshift', 'shake']) expect(moreEffectUniforms(t, zero, { k: 1, time: 0, d: {} })).toBe('skip');
  });

  it('turn the shapes and colors into numbers', () => {
    const lb = moreEffectUniforms('letterbox', (k, d = 0) => (k === 'ratio' ? 3 : d), { k: 1, time: 0, d: {} });
    expect(lb).toEqual({ uRatio: 4 / 3, uOpacity: 1 });
    const tint = moreEffectUniforms('tint', (_k, d = 0) => d, { k: 1, time: 0, d: { color: '#ff0080' } });
    expect(tint).toEqual({ uAmount: 0.4, uColor: [1, 0, 128 / 255] });
    expect(moreEffectUniforms('nope', () => 0, { k: 1, time: 0, d: {} })).toBeNull();
  });
});
