// The render cache's settings (kept on this computer, not in the project).
import type { Sequence } from '../model/types';
import type { CacheFormat } from './key';
import type { CacheMode } from './plan';

export interface CacheSettings {
  mode: CacheMode;
  /** Where cache files go (empty: the app's own cache folder). */
  folder: string;
  /** The cache is kept under this size (gigabytes); the oldest files go first. */
  limitGb: number;
  /** How big cache files are: the viewer's size (at most 1080 high), half the sequence's, or full. */
  size: 'viewer' | 'half' | 'full';
  /** Higher quality (bigger files). Needed for making the film from the cache. */
  high: boolean;
  /** Make the film from cached pictures where they are full size and high quality (off: always from the originals). */
  forExport: boolean;
  /** Decode with the graphics card (FFmpeg: proxies, cache, the film's originals). */
  hwDecode: boolean;
  /** Encode proxies and cache files with the graphics card's encoder. */
  hwEncode: boolean;
}

export const DEFAULT_SETTINGS: CacheSettings = {
  mode: 'smart',
  folder: '',
  limitGb: 20,
  size: 'viewer',
  high: false,
  forExport: false,
  hwDecode: true,
  hwEncode: true,
};

const KEY = 'lumora-edit-render-cache';

export function loadSettings(): CacheSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CacheSettings>;
    return { ...DEFAULT_SETTINGS, ...(typeof v === 'object' && v ? v : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: CacheSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not kept: fine.
  }
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** The size and quality of a sequence's cache files. */
export function formatFor(o: Pick<CacheSettings, 'size' | 'high'>, s: Pick<Sequence, 'width' | 'height'>): CacheFormat {
  const h = o.size === 'full' ? s.height : o.size === 'half' ? s.height / 2 : Math.min(s.height, 1080);
  return { height: even(h), high: o.high };
}

/** The width that goes with a cache height (the sequence's shape). */
export const widthFor = (height: number, s: Pick<Sequence, 'width' | 'height'>): number => even((height * s.width) / s.height);
