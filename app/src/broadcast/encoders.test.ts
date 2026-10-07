import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodersFound } from './BroadcastDialog';
import { replayExt, replayType } from './replay';
import { QUALITIES } from './recorder';

describe('the encoder settings', () => {
  it('say what the start-up check found', () => {
    expect(encodersFound({ hwChecked: false })).toMatch(/^Checking/);
    expect(encodersFound({ hwChecked: true, hwEncoders: ['h264_nvenc', 'hevc_nvenc'] })).toBe('Found here: NVIDIA (NVENC).');
    expect(encodersFound({ hwChecked: true, hwEncoders: [] })).toMatch(/processor does the encoding/);
    expect(encodersFound({ hwChecked: true, hwEncoders: ['h264_qsv'], hwFailed: ['qsv'] })).toBe(
      'Found here: Intel (Quick Sync). Stopped working this time (not used until Lumora restarts): Intel.',
    );
  });
  it('offer 4K at 60 frames a second', () => {
    expect(QUALITIES['2160p60']).toMatchObject({ width: 3840, height: 2160, fps: 60 });
  });
});

describe('instant replay', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses H.264 (the graphics card) only when the app can also play it back', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    expect(replayType(() => true)).toBe('video/x-matroska;codecs=avc1,opus');
    expect(replayType(() => false)).toBe('video/webm;codecs=vp9,opus');
    expect(replayExt('video/x-matroska;codecs=avc1,opus')).toBe('mkv');
    expect(replayExt('video/webm;codecs=vp9,opus')).toBe('webm');
  });
});
