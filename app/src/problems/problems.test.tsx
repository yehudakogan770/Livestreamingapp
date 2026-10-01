import { describe, expect, it, vi } from 'vitest';
import { ProblemStore } from './problems';

describe('problem center', () => {
  it('a problem stays until everyone who reported it says it is fixed', () => {
    const s = new ProblemStore();
    const tile = Symbol('tile');
    const monitor = Symbol('next monitor');
    const p = { key: 'source:a', level: 'error' as const, title: 'Cam: camera not found' };
    s.report(tile, p);
    s.report(monitor, p);
    expect(s.snapshot()).toHaveLength(1);
    s.clear(tile, 'source:a');
    expect(s.snapshot()).toHaveLength(1);
    s.clear(monitor, 'source:a');
    expect(s.snapshot()).toHaveLength(0);
  });

  it('tells about a new problem once, and lists errors before warnings', () => {
    const s = new ProblemStore();
    const onNew = vi.fn();
    s.onNew = onNew;
    const me = Symbol('me');
    s.report(me, { key: 'w', level: 'warning', title: 'Sound is waiting' });
    s.report(me, { key: 'e', level: 'error', title: 'Output closed' });
    s.report(me, { key: 'e', level: 'error', title: 'Output closed' });
    expect(onNew).toHaveBeenCalledTimes(2);
    expect(s.snapshot().map((p) => p.key)).toEqual(['e', 'w']);
  });
});
