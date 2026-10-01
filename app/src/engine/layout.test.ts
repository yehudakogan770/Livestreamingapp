import { describe, expect, it } from 'vitest';
import { cleanLayout, DEFAULT_LAYOUT, swapped } from './layout';

describe('arranging the screen', () => {
  it('swaps two parts of a row', () => {
    expect(swapped(['next', 'controls', 'program'], 'next', 'program')).toEqual(['program', 'controls', 'next']);
  });

  it('keeps a saved layout only when it makes sense', () => {
    expect(cleanLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(cleanLayout({ top: ['next', 'next', 'program'] }).top).toEqual(DEFAULT_LAYOUT.top);
    expect(cleanLayout({ presets: 'right', stage: 2, mixer: 5 })).toMatchObject({ presets: 'right', stage: 0.85, mixer: 220 });
    expect(cleanLayout({ bottom: ['mixer', 'inputs'] }).bottom).toEqual(['mixer', 'inputs']);
  });
});
