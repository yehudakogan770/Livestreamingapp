import { describe, expect, it } from 'vitest';
import { linkPrepared, mediaFrom, setPlaybackProxy } from '../model/build';
import { DEFAULT_TEXT, emptyProject, type MediaItem } from '../model/types';
import { textStamp, wordsAt } from '../render/text';
import { dropLevel } from '../ui/Playback';
import { FfmpegReader } from '../export/exporter';
import { exportSources, playbackFile, wantsProxy } from './files';
import { FrameStore, aheadCount, frameKey, framesAhead, missing, snapTime } from './framecache';

const media = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: 'm1',
  name: 'A',
  path: '/a.mov',
  proxy: null,
  kind: 'video',
  duration: 60,
  width: 3840,
  height: 2160,
  fps: 25,
  hasVideo: true,
  hasAudio: true,
  bin: null,
  ...over,
});

const heavyInfo = { codec: 'h264', bitDepth: 8, hdr: false, rotation: 0, vfr: false, bitrateKbps: 100000, heavy: true, exportVia: 'original' as const };

describe('which file plays and which makes the film', () => {
  it('plays from the proxy only when asked, and never makes the film from it', () => {
    const m = media({ playbackProxy: '/cache/a.proxy.mp4', source: heavyInfo });
    expect(playbackFile(m, true)).toBe('/cache/a.proxy.mp4');
    expect(playbackFile(m, false)).toBe('/a.mov');
    expect(exportSources(m, true).map((s) => s.path)).not.toContain('/cache/a.proxy.mp4');
    expect(exportSources(m, true)).toEqual([
      { via: 'decoder', path: '/a.mov' },
      { via: 'ffmpeg', path: '/a.mov' },
    ]);
  });

  it('reads originals the app cannot decode through FFmpeg, with the copy as a last resort', () => {
    const prores = media({ proxy: '/cache/a.edit.mp4', source: { ...heavyInfo, codec: 'prores', bitDepth: 10, exportVia: 'ffmpeg' } });
    expect(playbackFile(prores, false)).toBe('/cache/a.edit.mp4');
    expect(exportSources(prores, true)).toEqual([
      { via: 'ffmpeg', path: '/a.mov' },
      { via: 'decoder', path: '/cache/a.edit.mp4' },
    ]);
    // In a plain browser there is no FFmpeg.
    expect(exportSources(prores, false)).toEqual([{ via: 'decoder', path: '/cache/a.edit.mp4' }]);
    // The original is gone: only the copy is left.
    expect(exportSources({ ...prores, missing: true }, true)).toEqual([{ via: 'decoder', path: '/cache/a.edit.mp4' }]);
  });

  it('wants proxies only for heavy video without one', () => {
    expect(wantsProxy(media({ source: heavyInfo }))).toBe(true);
    expect(wantsProxy(media({ source: heavyInfo, playbackProxy: '/p.mp4' }))).toBe(false);
    expect(wantsProxy(media({ source: { ...heavyInfo, heavy: false } }))).toBe(false);
    expect(wantsProxy(media())).toBe(false);
    expect(wantsProxy(media({ source: heavyInfo, kind: 'audio' }))).toBe(false);
  });

  it('links a finished copy and a proxy without losing anything', () => {
    const item = mediaFrom(
      { path: '/a.mov', durationMs: 0, hasVideo: true, hasAudio: true, width: 1920, height: 1080, pending: true, source: { ...heavyInfo, note: null } },
      'A',
    );
    expect(item.preparing).toBe(true);
    expect(item.source?.note).toBeUndefined();
    const p = { ...emptyProject('T'), media: [item] };
    const q = linkPrepared(p, item.id, {
      path: '/a.mov',
      proxy: '/cache/a.edit.mp4',
      durationMs: 12_000,
      fps: 30,
      hasVideo: true,
      hasAudio: true,
      width: 1080,
      height: 1920,
      source: { ...heavyInfo, rotation: 90, note: 'Variable frame rate: made constant at 30 fps for editing.' },
    });
    const m = q.media[0] as MediaItem;
    expect(m.preparing).toBeUndefined();
    expect(m.proxy).toBe('/cache/a.edit.mp4');
    expect([m.duration, m.fps, m.width, m.height]).toEqual([12, 30, 1080, 1920]);
    expect(m.source?.note).toContain('constant');
    expect(setPlaybackProxy(q, item.id, '/p.mp4').media[0]?.playbackProxy).toBe('/p.mp4');
  });
});

describe('frames decoded ahead', () => {
  it('lets the least recently used go first, within the budget', () => {
    const gone: string[] = [];
    const s = new FrameStore<string>(30, (v) => gone.push(v));
    s.put('a', 'A', 10);
    s.put('b', 'B', 10);
    s.put('c', 'C', 10);
    s.get('a');
    s.put('d', 'D', 10);
    expect(gone).toEqual(['B']);
    expect([s.has('a'), s.has('c'), s.has('d'), s.bytes]).toEqual([true, true, true, 30]);
    s.put('a', 'A2', 10);
    expect(gone).toEqual(['B', 'A']);
    s.clear();
    expect(s.size).toBe(0);
    // One frame bigger than the budget still stays (the newest).
    const t = new FrameStore<string>(5);
    t.put('x', 'X', 50);
    expect(t.has('x')).toBe(true);
  });

  it('plans the frames coming up, on the file grid', () => {
    expect(framesAhead({ time: 1, fps: 25, step: 1 / 25, count: 3, duration: 60 })).toEqual([1, 1.04, 1.08]);
    // Backwards.
    expect(framesAhead({ time: 1, fps: 25, step: -1 / 25, count: 3, duration: 60 })).toEqual([1, 0.96, 0.92]);
    // A 25 fps file in a 50 fps sequence: each file frame once.
    expect(framesAhead({ time: 0, fps: 25, step: 1 / 50, count: 3, duration: 60 })).toEqual([0, 0.04, 0.08]);
    // Not past the end.
    expect(framesAhead({ time: 59.92, fps: 25, step: 1 / 25, count: 10, duration: 60 })).toHaveLength(2);
    // Not before the start going backwards.
    expect(framesAhead({ time: 0.04, fps: 25, step: -1 / 25, count: 10, duration: 60 })).toEqual([0.04, 0]);
    expect(frameKey('f', 1.04, 25)).toBe('f#26');
    expect(snapTime(1.039, 25)).toBeCloseTo(1.04);
    expect(missing('f', [1.08, 1, 1.04], 25, (k) => k === 'f#26')).toEqual([1, 1.08]);
    expect(aheadCount(-1, true)).toBeGreaterThan(aheadCount(1, true));
    expect(aheadCount(0, false)).toBeLessThan(aheadCount(1, true));
  });
});

describe('playback health', () => {
  it('turns from green to red as frames drop', () => {
    expect(dropLevel({ drawn: 3, dropped: 0, late: 0 })).toBe('idle');
    expect(dropLevel({ drawn: 1000, dropped: 2, late: 0 })).toBe('ok');
    expect(dropLevel({ drawn: 1000, dropped: 20, late: 10 })).toBe('warn');
    expect(dropLevel({ drawn: 1000, dropped: 100, late: 0 })).toBe('bad');
  });

  it('reads FFmpeg frames in order and starts again on a jump', () => {
    expect(FfmpegReader.continues(1.04, 1.04, 0.04)).toBe(true);
    expect(FfmpegReader.continues(1.04, 1.2, 0.04)).toBe(false);
  });
});

describe('titles drawn again only when they change', () => {
  const t = { ...DEFAULT_TEXT, text: 'Hello', animIn: 'fade' as const, animOut: 'fade' as const, animLength: 10 };
  it('keeps the same picture through the still middle', () => {
    expect(textStamp(t, 20, 100)).toBe(textStamp(t, 50, 100));
    expect(textStamp(t, 2, 100)).not.toBe(textStamp(t, 3, 100));
    expect(textStamp(t, 95, 100)).not.toBe(textStamp(t, 50, 100));
    expect(textStamp({ ...t, color: '#ff0000' }, 50, 100)).not.toBe(textStamp(t, 50, 100));
  });
  it('counts down', () => {
    const c = { ...t, text: '{count}', animIn: 'none' as const, animOut: 'none' as const };
    expect(wordsAt(c, 0, 90, 30)).toBe('3');
    expect(wordsAt(c, 31, 90, 30)).toBe('2');
    expect(wordsAt(c, 89, 90, 30)).toBe('1');
    expect(wordsAt({ ...c, text: 'Starts in {clock}' }, 0, 30 * 75, 30)).toBe('Starts in 1:15');
    expect(textStamp(c, 0, 90, 30)).not.toBe(textStamp(c, 40, 90, 30));
    expect(textStamp(c, 0, 90, 30)).toBe(textStamp(c, 10, 90, 30));
    expect(wordsAt({ ...t, caps: true }, 0, 10)).toBe('HELLO');
  });
});
