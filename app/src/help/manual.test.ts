import { describe, expect, it } from 'vitest';
import { MANUAL, searchManual } from './manual';

describe('the manual', () => {
  it('has distinct topics, each with something in it', () => {
    expect(new Set(MANUAL.map((t) => t.id)).size).toBe(MANUAL.length);
    for (const t of MANUAL) expect(t.body.length).toBeGreaterThan(0);
  });

  it('finds topics by any word, the title first', () => {
    expect(searchManual('')).toHaveLength(MANUAL.length);
    expect(searchManual('pesukim')[0]!.id).toBe('pesukim');
    expect(searchManual('zoom focus').map((t) => t.id)).toContain('cameras');
    expect(searchManual('nothing-like-this')).toHaveLength(0);
  });
});
