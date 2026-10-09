import { describe, expect, it } from 'vitest';
import { TRANSITION_FS, TRANSITION_TYPES } from '../render/shaders';
import { TRANSITION_GROUPS, TRANSITIONS } from './effects';

describe('transition library', () => {
  const video = TRANSITIONS.filter((t) => t.kind === 'video');

  it('draws every listed video transition (each has its own branch in the shader)', () => {
    for (const t of video) expect(TRANSITION_TYPES, t.type).toContain(t.type);
    // One branch per type: the last is the shader's final else.
    const branches = TRANSITION_FS.match(/uType == \d+/g) ?? [];
    const numbers = new Set(branches.map((b) => Number(b.replace(/\D+/g, ''))));
    for (let i = 0; i < TRANSITION_TYPES.length - 1; i++) expect(numbers.has(i), `type ${i}`).toBe(true);
  });

  it('lists every type the shader draws, once, in a known group', () => {
    expect(new Set(video.map((t) => t.type)).size).toBe(video.length);
    expect(new Set(TRANSITION_TYPES)).toEqual(new Set(video.map((t) => t.type)));
    for (const t of video) expect(TRANSITION_GROUPS).toContain(t.group);
    expect(video.length).toBeGreaterThanOrEqual(35);
  });

  it('keeps the original types where saved projects expect them', () => {
    expect(TRANSITION_TYPES.slice(0, 15)).toEqual([
      'dissolve',
      'dipblack',
      'dipwhite',
      'filmdissolve',
      'wipeleft',
      'wiperight',
      'wipeup',
      'wipedown',
      'slideleft',
      'slideright',
      'pushleft',
      'pushright',
      'iris',
      'zoom',
      'blurdissolve',
    ]);
  });
});
