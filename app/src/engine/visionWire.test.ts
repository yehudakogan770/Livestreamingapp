import { expect, test } from 'vitest';
import { decodeFrames, encodeResults } from './visionWire';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((x) => parseInt(x, 16)));

// The same bytes crates/live-engine/src/vision.rs writes and reads in `the_same_bytes_as_the_web_side`.
test('reads the frames the engine writes', () => {
  const frames = decodeFrames(unhex('4c5646310100030063616d07000000000000000100000001000000090807ff'));
  expect(frames).toHaveLength(1);
  const f = frames[0]!;
  expect([f.id, f.seq, f.w, f.h, [...f.rgba]]).toEqual(['cam', 7, 1, 1, [9, 8, 7, 255]]);
  // Nothing came (the engine waited and had none): no frames.
  expect(decodeFrames(new Uint8Array())).toEqual([]);
  expect(() => decodeFrames(unhex('4c56463101000300'))).toThrow();
});

test('writes the results the engine reads', () => {
  const bytes = encodeResults([
    {
      id: 'cam',
      mask: { w: 2, h: 1, data: new Uint8Array([0, 255]) },
      shot: { cx: 0.25, cy: 0.5, zoom: 2 },
      back: { w: 1, h: 1, rgba: new Uint8Array([1, 2, 3, 255]) },
      front: null,
    },
  ]);
  expect(hex(bytes)).toBe('4c5652310100030063616d0f0200010000ff0000803e0000003f0000004001000100010203ff00000000');
});

test('no mask, no shot and pictures left as they are: just the id', () => {
  const bytes = encodeResults([{ id: 'b', mask: null, shot: null }]);
  expect(hex(bytes)).toBe('4c56523101000100' + '62' + '00');
});
