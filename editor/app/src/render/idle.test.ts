import { describe, expect, it } from 'vitest';
import { newEffect } from '../model/effects';
import { emptyProject, newClip, type Project } from '../model/types';
import { frameOps, idleEffect } from './frame';

const now = (type: string, p: Record<string, number> = {}) => ({ type, p });

describe('effects that change nothing are not drawn', () => {
  it('knows a correction at its defaults, and an amount of 0', () => {
    expect(idleEffect(now('basic', { exposure: 0, contrast: 0, saturation: 100 }))).toBe(true);
    expect(idleEffect(now('basic', { exposure: 0.1 }))).toBe(false);
    expect(idleEffect(now('basic', { saturation: 90 }))).toBe(false);
    expect(idleEffect(now('vignette', { amount: 0, size: 60 }))).toBe(true);
    expect(idleEffect(now('vignette', { amount: -40 }))).toBe(false);
    expect(idleEffect(now('bw', { mix: 0 }))).toBe(true);
    expect(idleEffect(now('bw', {}))).toBe(false);
    expect(idleEffect(now('sharpen', { amount: 0 }))).toBe(true);
    expect(idleEffect(now('blur', { radius: 0 }))).toBe(true);
    expect(idleEffect(now('blur', { radius: 4 }))).toBe(false);
    expect(idleEffect(now('hsl', { hue: 120, range: 30, shift: 0, sat: 0, light: 0 }))).toBe(true);
    // Anything not known to be idle is drawn.
    expect(idleEffect(now('grade'))).toBe(false);
    expect(idleEffect(now('mask'))).toBe(false);
    expect(idleEffect(now('glow', { amount: 0 }))).toBe(false);
  });

  it('leaves them out of the frame, keeping the ones that do something', () => {
    const p0 = emptyProject('Test');
    const s = p0.sequences[0]!;
    const v1 = s.tracks.find((t) => t.kind === 'video')!;
    const c = newClip(v1.id, 0, 30, { kind: 'color', color: '#336699' }, 'Color');
    const basic = newEffect('basic');
    const vig = newEffect('vignette');
    c.effects = [basic, { ...newEffect('blur'), p: { radius: 0 } }, vig];
    const p: Project = { ...p0, sequences: [{ ...s, clips: [c] }] };
    const op = frameOps(p, p.sequences[0]!, 5)[0];
    expect(op?.kind).toBe('layer');
    const ids = op?.kind === 'layer' ? op.layer.effects.map((e) => e.id) : [];
    expect(ids).toEqual([vig.id]);
  });
});
