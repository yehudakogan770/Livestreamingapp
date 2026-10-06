import { describe, expect, it } from 'vitest';
import { bytesText, playbackReport } from './report';

describe('the playback report', () => {
  it('says the frame rate achieved, drops, drawing time and the cache', () => {
    const lines = playbackReport({ drawn: 300, dropped: 12, late: 3, composeMs: 41.66, fps: 22, cached: 150 }, 25, {
      made: 4,
      frames: 200,
      ms: 10000,
      bytes: 3 * 1024 ** 3,
      files: 9,
      mode: 'smart',
    });
    expect(lines).toEqual([
      'Playing at 22 of 25 fps',
      'Dropped frames: 12 · late pictures: 3 · drawn: 300',
      '41.7 ms to draw a frame (40.0 ms per frame available)',
      '50% of frames came from the render cache',
      'Render cache (smart): 9 files, 3.0 GB · 4 made this session at 20.0 fps',
    ]);
    const idle = playbackReport({ drawn: 0, dropped: 0, late: 0, composeMs: 0, fps: 0, cached: 0 }, 29.97, {
      made: 0,
      frames: 0,
      ms: 0,
      bytes: 0,
      files: 0,
      mode: 'off',
    });
    expect(idle[0]).toBe('Not played yet (the sequence runs at 29.97 fps)');
    expect(idle).toHaveLength(3);
    expect(bytesText(5 * 1024 ** 2)).toBe('5 MB');
  });
});
