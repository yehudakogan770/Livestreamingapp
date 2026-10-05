import { describe, expect, it } from 'vitest';
import { RehearsalLog, verdict } from './rehearsal';

describe('rehearsal report', () => {
  it('says all went well when nothing went wrong', () => {
    const log = new RehearsalLog();
    log.sample(2, 1.01);
    expect(verdict(log.report()).good).toBe(true);
  });
  it('lists each problem once, and a busy computer', () => {
    const log = new RehearsalLog();
    const p = { key: 'cam', level: 'error' as const, title: 'Camera 2 unplugged', since: 0 };
    log.problems([p]);
    log.problems([p]);
    log.sample(120, 0.8);
    const v = verdict(log.report());
    expect(v.good).toBe(false);
    expect(v.lines.filter((l) => l.includes('Camera 2'))).toHaveLength(1);
    expect(v.lines.some((l) => l.includes('120 frames'))).toBe(true);
    expect(v.lines.some((l) => l.includes('80%'))).toBe(true);
  });
});
