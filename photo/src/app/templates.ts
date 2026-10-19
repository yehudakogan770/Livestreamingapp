// Document sizes for the start screen and File ▸ New, by use.

import type { Depth } from '../core/types';
import type { Background } from '../core/doc';

export interface Preset {
  name: string;
  group: 'Photo' | 'Print' | 'Web and social' | 'Video and live';
  width: number;
  height: number;
  resolution: number;
  depth?: Depth;
  background?: Background;
  note?: string;
}

export const PRESETS: Preset[] = [
  { name: 'Photo, 6 × 4 in', group: 'Photo', width: 1800, height: 1200, resolution: 300 },
  { name: 'Photo, 7 × 5 in', group: 'Photo', width: 2100, height: 1500, resolution: 300 },
  { name: 'Photo, 10 × 8 in', group: 'Photo', width: 3000, height: 2400, resolution: 300 },
  { name: 'Letter', group: 'Print', width: 2550, height: 3300, resolution: 300 },
  { name: 'A4', group: 'Print', width: 2480, height: 3508, resolution: 300 },
  { name: 'Tabloid', group: 'Print', width: 3300, height: 5100, resolution: 300 },
  { name: 'Postcard', group: 'Print', width: 1800, height: 1200, resolution: 300 },
  { name: 'Square post', group: 'Web and social', width: 1080, height: 1080, resolution: 72 },
  { name: 'Portrait post', group: 'Web and social', width: 1080, height: 1350, resolution: 72 },
  { name: 'Story', group: 'Web and social', width: 1080, height: 1920, resolution: 72 },
  { name: 'Web banner', group: 'Web and social', width: 1500, height: 500, resolution: 72 },
  { name: 'Video thumbnail', group: 'Web and social', width: 1280, height: 720, resolution: 72 },
  { name: 'HD 1080p', group: 'Video and live', width: 1920, height: 1080, resolution: 72 },
  { name: '4K UHD', group: 'Video and live', width: 3840, height: 2160, resolution: 72 },
  { name: 'Overlay for Lumora', group: 'Video and live', width: 1920, height: 1080, resolution: 72, background: 'transparent', note: 'Transparent, for Lumora and Studio' },
  { name: 'Lower third', group: 'Video and live', width: 1920, height: 1080, resolution: 72, background: 'transparent', note: 'Transparent, for Lumora Titler' },
];
