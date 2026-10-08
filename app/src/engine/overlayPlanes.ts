// Which graphics planes a screen needs at one moment, for the unified
// engine's overlay renderer. It follows the engine's own scene rules
// (crates/live-engine/src/scene.rs: `pictures_in`, `overlay_layers`) so each
// plane is drawn at exactly the size the engine shows it:
//
// - `g:<input>` — a graphics input on air (the whole screen), in a split
//   screen's box (that box's size) or in an overlay channel (the channel's box);
// - `top` — the stinger video, over everything but blank and PANIC;
// - `panic` — the PANIC safe screen's logo (the engine draws the black itself).
// - `n:g:<input>` — a graphics input lined up in Next (the Next preview, drawn
//   half size, only while the control window or the multiview shows it);
// - `mv:g:<input>` — a graphics input's tile in the engine's multiview while
//   it isn't on air on the Live Screen (on air, its `g:` plane serves);
// - `cap` — the live captions written into the stream (Live only; the engine
//   puts it on the stream and its vertical version, never on the screen);
// - `mon` — the stage monitor's words (the Monitor in the engine's window).
//
// Inputs the engine draws itself (cameras, files, pictures, streams, colors,
// split-screen backgrounds) have no plane.

import { programLayers, type StingerPlay } from '../components/ScreenView';
import { overlayLook, overlaysOn } from './overlays';
import { fadeAmount } from './timing';
import type { Overlay } from './types/Overlay';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';
import type { Source } from './types/Source';

/** Kinds the engine draws itself (`is_video_kind`, colors, splits, microphones). */
export const ENGINE_DRAWN: ReadonlySet<string> = new Set([
  'camera',
  'video',
  'image',
  'pattern',
  'stream',
  'screen',
  'guest',
  'browser',
  'color',
  'microphone',
  'split',
]);

export type PlaneSpec =
  | { kind: 'input'; name: string; w: number; h: number; sourceId: string; screen?: ScreenId }
  | { kind: 'channel'; name: string; w: number; h: number; sourceId: string; changedAt: number; on?: boolean }
  | { kind: 'top'; name: 'top'; w: number; h: number; stinger: StingerPlay }
  | { kind: 'panic'; name: 'panic'; w: number; h: number }
  /** The words of the engine's multiview (the Live Screen's renderer draws them). */
  | { kind: 'multiview'; name: 'mv'; w: number; h: number }
  /** Its timecodes (a small plane each, changing every frame): the header's, and the screens' tiles'. */
  | { kind: 'timecode'; name: 'tc' | 'tc2'; w: number; h: number }
  /** The live captions written into the stream picture. */
  | { kind: 'captions'; name: 'cap'; w: number; h: number }
  /** The stage monitor's words, for the Monitor's slot (`screen`: 'monitor'). */
  | { kind: 'monitor'; name: 'mon'; w: number; h: number; screen: 'monitor' };

/** The prefix of the Next preview's planes. */
export const NEXT_PREFIX = 'n:';

/**
 * The planes of what is lined up in Next on `screen` (the engine draws the
 * Next preview at `w` × `h`, half the screen): graphics inputs, and the
 * graphics boxes of a split screen, named `n:g:<input>`.
 */
export function nextPlanes(show: Show, screen: ScreenId, w: number, h: number): PlaneSpec[] {
  const id = show.screens[screen].preview;
  const src = id === null ? undefined : show.sources.find((s) => s.id === id);
  if (!src) return [];
  const out: PlaneSpec[] = [];
  const one = (s: Source, pw: number, ph: number) => {
    if (ENGINE_DRAWN.has(s.kind.type)) return;
    const name = `${NEXT_PREFIX}g:${s.id}`;
    if (!out.some((p) => p.name === name)) out.push({ kind: 'input', name, w: Math.max(1, Math.round(pw)), h: Math.max(1, Math.round(ph)), sourceId: s.id });
  };
  if (src.kind.type === 'split') {
    for (const b of src.kind.boxes) {
      const inner = b.sourceId === null ? undefined : show.sources.find((s) => s.id === b.sourceId);
      if (inner && inner.kind.type !== 'split') one(inner, (b.frame.w / 100) * w, (b.frame.h / 100) * h);
    }
  } else one(src, w, h);
  return out;
}

/** The prefix of the multiview's own copies of graphics inputs (`mv:g:<input>`). */
export const MV_PREFIX = 'mv:';

/**
 * The planes of the engine's multiview tiles that show a graphics input not
 * on air on the Live Screen (so not drawn there already): `mv:g:<input>` at
 * the tile picture's size (fitted to the screen's shape, `aspect` = w / h).
 * Inputs the engine draws itself and splits need none.
 */
export function multiviewPlanes(
  show: Show,
  tiles: readonly { content: { type: string; id: string }; picture: [number, number, number, number] }[],
  onAir: ReadonlySet<string>,
  aspect: number,
): PlaneSpec[] {
  const out: PlaneSpec[] = [];
  for (const t of tiles) {
    if (t.content.type !== 'input') continue;
    const s = show.sources.find((x) => x.id === t.content.id);
    if (!s || ENGINE_DRAWN.has(s.kind.type) || onAir.has(`g:${s.id}`)) continue;
    const name = `${MV_PREFIX}g:${s.id}`;
    if (out.some((p) => p.name === name)) continue;
    const [, , pw, ph] = t.picture;
    const w = Math.max(1, Math.round(Math.min(pw, ph * aspect)));
    out.push({ kind: 'input', name, w, h: Math.max(1, Math.round(w / aspect)), sourceId: s.id });
  }
  return out;
}

/** A plane's identity: its name and size. */
export const planeKey = (p: { name: string; w: number; h: number }) => `${p.name}|${p.w}x${p.h}`;

/** The planes screen `screen` needs at `now`, drawn `w` × `h`. */
export function overlayPlanes(show: Show, screen: ScreenId, now: number, w: number, h: number): PlaneSpec[] {
  const out = new Map<string, PlaneSpec>();
  const add = (p: PlaneSpec) => {
    const k = planeKey(p);
    if (!out.has(k)) out.set(k, p);
  };
  const find = (id: string | null) => (id === null ? undefined : show.sources.find((s) => s.id === id));
  /** One input inside a box of `bw` × `bh` (a split shows its boxes). */
  const input = (src: Source, bw: number, bh: number, channel: Overlay | null) => {
    const one = (s: Source, pw: number, ph: number) => {
      if (ENGINE_DRAWN.has(s.kind.type)) return;
      const size = { w: Math.max(1, Math.round(pw)), h: Math.max(1, Math.round(ph)) };
      const name = `g:${s.id}`;
      add(
        channel
          ? { kind: 'channel', name, ...size, sourceId: s.id, changedAt: channel.changedAt, on: channel.on }
          : { kind: 'input', name, ...size, sourceId: s.id },
      );
    };
    if (src.kind.type === 'split') {
      for (const b of src.kind.boxes) {
        const inner = find(b.sourceId);
        if (inner && inner.kind.type !== 'split') one(inner, (b.frame.w / 100) * bw, (b.frame.h / 100) * bh);
      }
    } else one(src, bw, bh);
  };
  const { layers, stinger } = programLayers(show, screen, now);
  for (const l of layers) {
    const src = find(l.id);
    if (src && l.opacity > 0) input(src, w, h, null);
  }
  for (const { o } of overlaysOn(show.overlays, screen, now)) {
    const look = overlayLook(o, now);
    const src = find(o.sourceId);
    if (src && look && look.opacity > 0) input(src, (o.frame.w / 100) * w, (o.frame.h / 100) * h, o);
  }
  if (stinger) add({ kind: 'top', name: 'top', w, h, stinger });
  if (show.event.panicShows === 'logo' && fadeAmount(show.panic, show.panicChangedAt, now) > 0) add({ kind: 'panic', name: 'panic', w, h });
  return [...out.values()];
}
