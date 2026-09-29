import { describe, expect, it } from 'vitest';
import { defaultWall, wallCard, wallGrid, wallPost, wallRemove, wallTicker } from './wall';

describe('messages wall', () => {
  it('shows only what was let through, taking turns, and the pinned one stays', () => {
    const w = defaultWall();
    expect(wallPost(w, 'Ana', '  ', '', true, 1)).toBe(false);
    wallPost(w, 'Ana', 'Mazel tov!', '', true, 1);
    wallPost(w, 'Ben', 'Waiting', '', false, 2);
    wallPost(w, 'Chaya', 'Siman tov', '', true, 3);
    expect(wallCard(w, 0)?.m.name).toBe('Ana');
    expect(wallCard(w, 8000 + 1000)?.m.name).toBe('Chaya');
    expect(wallCard(w, 16_000 + 1000)?.m.name).toBe('Ana');
    expect(wallCard(w, 8000 + 100)!.alpha).toBeLessThan(1);
    expect(wallTicker(w)).toBe('Mazel tov! — Ana     ✦     Siman tov — Chaya');
    w.pinned = 1;
    expect(wallCard(w, 9000)).toEqual({ m: w.messages[0], alpha: 1 });
    expect(wallGrid(w).map((m) => m.name)).toEqual(['Ana', 'Chaya']);
    wallRemove(w, 1);
    expect(w.pinned).toBeNull();
    expect(wallGrid(w).map((m) => m.name)).toEqual(['Chaya']);
  });
});
