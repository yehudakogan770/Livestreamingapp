// Which graphics planes a screen needs at one moment, for the unified
// engine's overlay renderer. It follows the engine's own scene rules
// (crates/live-engine/src/scene.rs: `pictures_in`, `overlay_layers`) so each
// plane is drawn at exactly the size the engine shows it:
//
// - `g:<input>` — a graphics input on air (the whole screen), in a split
//   screen's box (that box's size) or in an overlay channel (the channel's box);
// - `top` — the stinger video, over everything but blank and PANIC;
// - `panic` — the PANIC safe screen's logo (the engine draws the black itself).
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
  | { kind: 'input'; name: string; w: number; h: number; sourceId: string }
  | { kind: 'channel'; name: string; w: number; h: number; sourceId: string; changedAt: number }
  | { kind: 'top'; name: 'top'; w: number; h: number; stinger: StingerPlay }
  | { kind: 'panic'; name: 'panic'; w: number; h: number }
  /** The words of the engine's multiview (the Live Screen's renderer draws them). */
  | { kind: 'multiview'; name: 'mv'; w: number; h: number };

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
      add(channel ? { kind: 'channel', name, ...size, sourceId: s.id, changedAt: channel.changedAt } : { kind: 'input', name, ...size, sourceId: s.id });
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
