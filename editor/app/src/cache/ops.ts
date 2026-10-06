// A cached segment drawn in place of its layers: one full-frame video layer
// reading the cache file, so playback (video elements, decoded frames ahead
// of the playhead) and the film treat it like any other clip.
import { rate } from '../model/seq';
import { NO_MOTION, type Clip, type MediaItem, type Sequence } from '../model/types';
import type { Layer, MotionNow, Op } from '../render/frame';
import type { CacheFormat } from './key';
import { widthFor } from './settings';

interface Made {
  media: MediaItem;
  clip: Clip;
}

const made = new Map<string, Made>();

const MOTION: MotionNow = {
  x: 0,
  y: 0,
  scale: 100,
  scaleX: 100,
  rotation: 0,
  rotX: 0,
  rotY: 0,
  z: 0,
  cropL: 0,
  cropR: 0,
  cropT: 0,
  cropB: 0,
  opacity: 100,
  blend: 'normal',
  fill: true,
};

/** The media and clip standing for a cache file (the same objects each time, so nothing reloads). */
function madeFor(s: Sequence, seg: { from: number; to: number; key: string }, path: string, format: CacheFormat): Made {
  const id = `rcache:${seg.key}`;
  const had = made.get(id);
  if (had && had.media.path === path) return had;
  const fps = rate(s);
  const media: MediaItem = {
    id,
    name: 'Render cache',
    path,
    proxy: null,
    kind: 'video',
    duration: (seg.to - seg.from) / fps,
    width: widthFor(format.height, s),
    height: format.height,
    fps,
    hasVideo: true,
    hasAudio: false,
    bin: null,
  };
  const clip: Clip = {
    id,
    track: '',
    start: seg.from,
    length: seg.to - seg.from,
    name: 'Render cache',
    source: { kind: 'media', media: id, in: 0 },
    speed: 1,
    reverse: false,
    enabled: true,
    link: null,
    label: null,
    motion: { ...NO_MOTION, fill: true },
    effects: [],
    gain: 0,
    pan: 0,
    tIn: null,
    tOut: null,
  };
  const m = { media, clip };
  made.set(id, m);
  // Only the last few are kept.
  if (made.size > 64) made.delete(made.keys().next().value as string);
  return m;
}

/** What to draw at a frame of a cached segment. */
export function cachedOps(s: Sequence, seg: { from: number; to: number; key: string }, path: string, frame: number, format: CacheFormat): Op[] {
  const { media, clip } = madeFor(s, seg, path, format);
  const fps = rate(s);
  const local = Math.max(0, Math.min(seg.to - seg.from - 1, frame - seg.from));
  const layer: Layer = { clip, key: clip.id, fps, source: { kind: 'video', media, time: local / fps }, local, motion: MOTION, effects: [] };
  return [{ kind: 'layer', layer }];
}
