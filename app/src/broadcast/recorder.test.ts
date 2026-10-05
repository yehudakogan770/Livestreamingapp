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

describe('event file', () => {
  it('lists every file with when it started, and what was on air when', async () => {
    const { eventFile } = await import('./recorder');
    const f = eventFile(
      {
        name: 'Gala',
        startedAt: 1000,
        running: { session: 1, startedAt: 1000, path: 'C:\\Videos\\Gala.mkv', destinations: [], bytes: 0, speed: null },
        isos: [{ kind: 'camera', sourceId: 'cam1', name: 'Stage', path: 'C:\\Videos\\Gala — event files\\Stage.mkv', startMs: 420 }] as never,
        cuts: [{ at: 0, id: 'cam1', name: 'Stage' }],
      },
      61_000,
    );
    expect(f.program.mp4).toBe('C:\\Videos\\Gala.mp4');
    expect(f.durationMs).toBe(60_000);
    expect(f.files[0]).toMatchObject({ kind: 'camera', name: 'Stage', startMs: 420 });
    expect(f.cuts).toHaveLength(1);
  });
});
