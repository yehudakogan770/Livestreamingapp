import { describe, expect, it } from 'vitest';
import { chapterText, chapterTime } from './recorder';

describe('chapters', () => {
  it('write times as YouTube expects', () => {
    expect(chapterTime(0)).toBe('0:00');
    expect(chapterTime(83_500)).toBe('1:23');
    expect(chapterTime(3_725_000)).toBe('1:02:05');
  });

  it('list what was on air, starting at 0:00, leaving out quick flicks', () => {
    const text = chapterText([
      { at: 2_000, name: 'Opening' },
      { at: 65_000, name: 'Camera 1' },
      { at: 68_000, name: 'Video' },
      { at: 70_000, name: 'Camera 1' },
      { at: 200_000, name: 'Speaker' },
    ]);
    expect(text).toBe('0:00 Opening\n1:10 Camera 1\n3:20 Speaker\n');
  });
});
