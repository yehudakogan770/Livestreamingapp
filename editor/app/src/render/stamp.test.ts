import { describe, expect, it } from 'vitest';
import { pictureStamp } from './compositor';

describe('picture stamps (the same pixels are not uploaded again)', () => {
  it('a decoded frame keeps its stamp; another frame has another', () => {
    const a = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
    const b = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
    expect(pictureStamp(a)).toBe(pictureStamp(a));
    expect(pictureStamp(a)).not.toBe(pictureStamp(b));
    expect(pictureStamp(a)).not.toBe('');
  });
  it('a frame let go of (made empty) is not the same picture', () => {
    const a = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
    const before = pictureStamp(a);
    a.width = 0;
    expect(pictureStamp(a)).not.toBe(before);
  });
  it('a playing video, or one not ready, is uploaded every time', () => {
    const v = document.createElement('video');
    // jsdom: never ready (readyState 0).
    expect(pictureStamp(v)).toBe('');
    expect(pictureStamp({ width: 10, height: 10 } as unknown as TexImageSource)).toBe('');
  });
  it('a stopped video shown at a time keeps its stamp until it moves', () => {
    const v = document.createElement('video');
    let time = 1.5;
    Object.defineProperty(v, 'readyState', { value: 4 });
    Object.defineProperty(v, 'paused', { value: true });
    Object.defineProperty(v, 'seeking', { value: false });
    Object.defineProperty(v, 'currentTime', { get: () => time });
    const s1 = pictureStamp(v);
    expect(s1).not.toBe('');
    expect(pictureStamp(v)).toBe(s1);
    time = 2;
    expect(pictureStamp(v)).not.toBe(s1);
  });
});
