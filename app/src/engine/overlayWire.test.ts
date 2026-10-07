import { expect, test } from 'vitest';
import { cutRect, encodeWire } from './overlayWire';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// The same bytes crates/live-engine/src/overlay.rs reads in `reads_what_the_web_renderer_writes`.
test('writes what the engine reads', () => {
  const bytes = encodeWire([
    {
      op: 'patch',
      screen: 'live',
      name: 'g:title',
      w: 3,
      h: 2,
      at: 12345,
      rects: [{ rect: { x: 1, y: 0, w: 2, h: 1 }, pixels: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }],
    },
    { op: 'clear', screen: 'back', name: 'panic', w: 3, h: 2, at: 0 },
  ]);
  expect(hex(bytes)).toBe(
    '4c4f5631020001000700673a7469746c6503000000020000003930000000000000010000000100000000000000020000000100000001020304050607080201050070616e69630300000002000000000000000000000000000000',
  );
});

test('a reset carries no name or pixels', () => {
  const bytes = encodeWire([{ op: 'reset', screen: 'back', at: 7 }]);
  // magic, count, op 3, screen 1, name length 0, w 0, h 0, at 7, no rectangles.
  expect(bytes.length).toBe(6 + 4 + 8 + 8 + 4);
  expect(bytes[6]).toBe(3);
  expect(bytes[7]).toBe(1);
});

test('a rectangle is cut out of the whole picture row by row', () => {
  // 3 × 2 picture, pixel i has every byte = i.
  const img = new Uint8ClampedArray(3 * 2 * 4);
  for (let i = 0; i < 6; i++) img.fill(i, i * 4, i * 4 + 4);
  expect([...cutRect(img, 3, { x: 1, y: 0, w: 2, h: 2 })]).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 5, 5, 5, 5]);
  // Whole rows are a view, not a copy.
  const rows = cutRect(img, 3, { x: 0, y: 1, w: 3, h: 1 });
  expect(rows.buffer).toBe(img.buffer);
  expect([...rows.subarray(0, 4)]).toEqual([3, 3, 3, 3]);
});
