import { describe, expect, it } from 'vitest';
import { ALL_GROUPS, GROUPS, ROLES, makeRole, roleAllows, roleGroups, roleName, type Group, type Role } from './roles';

// The same table as crates/seats/tests/role_filter.rs (the show computer's
// check); this copy only greys out controls, so the two must agree.
const EXPECTED: Record<string, Group[]> = {
  director: ALL_GROUPS,
  graphics: ['overlays', 'titles', 'scoreboards', 'countdowns', 'lyrics', 'slides', 'data'],
  audio: ['audio'],
  replay: ['replay'],
  cameras: ['cameras', 'preview'],
};

describe('seat roles', () => {
  it('lists every group once, with words for the Custom list', () => {
    expect(new Set(ALL_GROUPS).size).toBe(19);
    for (const g of GROUPS) expect(g.name.length).toBeGreaterThan(2);
  });

  it('gives each role exactly its groups', () => {
    for (const [kind, groups] of Object.entries(EXPECTED)) {
      const role = makeRole(kind as Role['kind']);
      for (const g of ALL_GROUPS) expect(roleAllows(role, g), `${kind} ${g}`).toBe(groups.includes(g));
    }
  });

  it('graphics never cuts, goes live or records', () => {
    const g: Role = { kind: 'graphics' };
    for (const x of ['switching', 'preview', 'recording', 'replay', 'audio', 'cameras'] as Group[]) expect(roleAllows(g, x)).toBe(false);
  });

  it('a custom role has only what was ticked, in the list’s order', () => {
    const r: Role = { kind: 'custom', groups: ['audio', 'lyrics', 'audio'] };
    expect(roleGroups(r)).toEqual(['lyrics', 'audio']);
    expect(roleAllows(r, 'switching')).toBe(false);
    expect(roleGroups({ kind: 'custom', groups: [] })).toEqual([]);
  });

  it('names roles and keeps ticked groups when switching to Custom', () => {
    expect(ROLES.map((r) => r.kind)).toEqual(['director', 'graphics', 'audio', 'replay', 'cameras', 'custom']);
    expect(roleName({ kind: 'cameras' })).toBe('Cameras');
    expect(makeRole('custom', ['slides'])).toEqual({ kind: 'custom', groups: ['slides'] });
    expect(makeRole('audio', ['slides'])).toEqual({ kind: 'audio' });
  });
});
