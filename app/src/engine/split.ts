// Split screens (mirrors crates/engine/src/split.rs): ready-made layouts.

import type { Frame } from './types/Frame';
import type { Split } from './types/Split';
import type { SplitLayout } from './types/SplitLayout';

export const SPLIT_LAYOUTS: { id: SplitLayout; name: string }[] = [
  { id: 'sideBySide', name: 'Side by side' },
  { id: 'pictureInPicture', name: 'Picture-in-picture' },
  { id: 'threeUp', name: 'One big, two small' },
  { id: 'grid', name: 'Four in a grid' },
  { id: 'custom', name: 'My own boxes' },
];

/** The boxes of a ready-made layout, in % of the frame. */
export function layoutFrames(layout: SplitLayout, g: number): Frame[] {
  const half = (100 - 3 * g) / 2;
  switch (layout) {
    case 'sideBySide': {
      const y = (100 - half) / 2;
      return [
        { x: g, y, w: half, h: half },
        { x: 2 * g + half, y, w: half, h: half },
      ];
    }
    case 'pictureInPicture':
      return [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 68, y: 6, w: 28, h: 28 },
      ];
    case 'threeUp': {
      const inner = 100 - 3 * g;
      const big = inner - inner / 3;
      const small = inner - big;
      const sh = (100 - 3 * g) / 2;
      return [
        { x: g, y: g, w: big, h: 100 - 2 * g },
        { x: 2 * g + big, y: g, w: small, h: sh },
        { x: 2 * g + big, y: 2 * g + sh, w: small, h: sh },
      ];
    }
    case 'grid':
      return [
        { x: g, y: g, w: half, h: half },
        { x: 2 * g + half, y: g, w: half, h: half },
        { x: g, y: 2 * g + half, w: half, h: half },
        { x: 2 * g + half, y: 2 * g + half, w: half, h: half },
      ];
    case 'custom':
      return [];
  }
}

/** Put the boxes where the layout has them, keeping their inputs. */
export function applyLayout(s: Split): Split {
  if (s.layout === 'custom') return s;
  const frames = layoutFrames(s.layout, s.gap);
  const boxes = frames.map((frame, i) => ({ sourceId: s.boxes[i]?.sourceId ?? null, frame }));
  return { ...s, boxes };
}

export function defaultSplit(): Split {
  return applyLayout({ layout: 'sideBySide', boxes: [], gap: 2, background: '#101216', border: false, borderColor: '#ffffff' });
}
