// The words of the multiview the unified engine draws (crates/live-engine/
// src/multiview.rs): the header strip (event, PANIC and blank tags, the
// clock) and each tile's label strip (number, name, on-air and next tags,
// the tally bar), drawn by the Live Screen's overlay renderer into the plane
// `mv` at the engine's own layout. The pictures and tally borders are the
// engine's. Looks follow app/src/views/MultiviewView.css.

import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';

export type Rect4 = [number, number, number, number];

export interface MvTile {
  content: { type: 'program' | 'next'; id: ScreenId } | { type: 'input'; id: string };
  rect: Rect4;
  picture: Rect4;
  label: Rect4;
  tally: 'pgm' | 'pvw' | 'none';
  big: boolean;
  number: number | null;
  /** Where its timecode goes (the screens' tiles): drawn from the small plane `tc2`. */
  timecode?: Rect4 | null;
}

export interface MvLayout {
  width: number;
  height: number;
  header: Rect4;
  /** The header's clock box: its timecode (with frames) is the small plane `tc`. */
  clock?: Rect4;
  tiles: MvTile[];
  /** CSS pixels to multiview pixels. */
  scale: number;
}

const FONT = "'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
const MONO = "'JetBrains Mono Variable', 'Cascadia Mono', Consolas, monospace";
const C = {
  label: '#121212',
  text: '#ffffff',
  dim: '#a3a3a0',
  faint: '#75756f',
  border: '#303030',
  pgmBright: '#ff4b3e',
  pvwBright: '#34d26b',
  pgm: '#d42f27',
  pvw: '#18994a',
  pvwInk: '#04120a',
};

const pad = (n: number) => String(n).padStart(2, '0');
/** The time of day, as the multiview's clock and timecodes show it (to the second: one change a second). */
export const clockText = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** The time of day as a timecode with frames, `HH:MM:SS:FF` at `fps` (the engine's multiview). */
export const timecodeText = (d: Date, fps: number) =>
  `${clockText(d)}:${pad(Math.min(Math.max(1, Math.round(fps)) - 1, Math.floor((d.getMilliseconds() * fps) / 1000)))}`;

/**
 * One of the engine multiview's timecode planes (`tc`: the header's clock, big;
 * `tc2`: the screens' tiles', small), `w` × `h`, see-through around the words.
 * They change every frame, so they are small planes of their own.
 */
export function drawTimecode(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, big: boolean, scale: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  if (big) {
    ctx.font = `600 ${Math.round(16 * scale)}px ${MONO}`;
    ctx.fillStyle = C.text;
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, h / 2 + scale);
  } else {
    ctx.font = `500 ${Math.round(12 * scale)}px ${MONO}`;
    ctx.fillStyle = C.faint;
    ctx.textAlign = 'right';
    ctx.fillText(text, w - 8 * scale, h / 2 + scale);
  }
  ctx.textAlign = 'left';
}

/** Where each source is on air ("LIVE", "BACK"), and what is next. */
export function tallies(show: Show): { onAir: Map<string, string[]>; next: Set<string> } {
  const onAir = new Map<string, string[]>();
  const next = new Set<string>();
  for (const [sc, name] of [
    [show.screens.live, 'LIVE'],
    [show.screens.back, 'BACK'],
  ] as const) {
    if (sc.program) onAir.set(sc.program, [...(onAir.get(sc.program) ?? []), name]);
    if (sc.preview && sc.preview !== sc.program) next.add(sc.preview);
  }
  return { onAir, next };
}

/** Draw the multiview's words for `show` at `now` (the canvas is cleared to see-through first). */
export function drawMultiviewWords(ctx: CanvasRenderingContext2D, layout: MvLayout, show: Show, now: number): void {
  const s = layout.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.textBaseline = 'middle';
  const font = (px: number, weight: number, mono = false) => `${weight} ${Math.round(px * s)}px ${mono ? MONO : FONT}`;
  /** A tag pill; returns its width. */
  const tag = (text: string, x: number, cy: number, bg: string, ink: string) => {
    ctx.font = font(10, 700);
    const w = ctx.measureText(text).width + 12 * s;
    const h = 15 * s;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect?.(x, cy - h / 2, w, h, 2 * s);
    if (!ctx.roundRect) ctx.rect(x, cy - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.fillText(text, x + 6 * s, cy + 0.5 * s);
    return w;
  };
  const text = (t: string, x: number, cy: number, f: string, color: string, max?: number) => {
    ctx.font = f;
    ctx.fillStyle = color;
    ctx.fillText(t, x, cy, max);
    return ctx.measureText(t).width;
  };
  const clock = clockText(new Date(now));
  // ---- the header ----
  const [hx, hy, hw, hh] = layout.header;
  const hc = hy + hh / 2;
  let x = hx + 6 * s;
  ctx.fillStyle = C.pgmBright;
  ctx.beginPath();
  ctx.arc(x + 9 * s, hc, 7 * s, 0, Math.PI * 2);
  ctx.fill();
  x += 28 * s;
  x += text(show.event.name || 'Lumora', x, hc, font(13, 600), C.text) + 10 * s;
  x += text('Multiview', x, hc, font(13, 500), C.faint) + 10 * s;
  if (show.panic) x += tag('PANIC', x, hc, C.pgmBright, C.text) + 10 * s;
  if (show.screens.live.blank) x += tag('LIVE BLANK', x, hc, C.pgmBright, C.text) + 10 * s;
  if (show.screens.back.blank) x += tag('BACK BLANK', x, hc, C.pgmBright, C.text) + 10 * s;
  ctx.font = font(16, 600, true);
  // The engine's layout gives the clock a box of its own; its time (with
  // frames) is the small plane `tc`, drawn there every frame.
  const box = layout.clock;
  const cw = box ? box[2] : ctx.measureText(clock).width + 20 * s;
  const ch = box ? box[3] : 26 * s;
  const cx = box ? box[0] : hx + hw - 6 * s - cw;
  const cy = box ? box[1] : hc - ch / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(cx, cy, cw, ch);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = Math.max(1, s);
  ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
  if (!box) text(clock, cx + 10 * s, hc + s, font(16, 600, true), C.text);
  // ---- the label strips ----
  const { onAir, next } = tallies(show);
  const nameOf = (id: string | null) => (id ? (show.sources.find((x) => x.id === id)?.name ?? '') : 'nothing');
  for (const t of layout.tiles) {
    const [lx, ly, lw, lh] = t.label;
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx, ly, lw, lh);
    ctx.clip();
    ctx.fillStyle = C.label;
    ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = '#000';
    ctx.fillRect(lx, ly, lw, Math.max(1, s));
    if (t.tally !== 'none') {
      ctx.fillStyle = t.tally === 'pgm' ? C.pgmBright : C.pvwBright;
      ctx.fillRect(lx, ly, lw, 3 * s);
    }
    const cy = ly + lh / 2 + 1 * s;
    let x = lx + 8 * s;
    const size = t.big ? 16 : 13;
    if (t.content.type === 'input') {
      const id = t.content.id;
      x += text(String(t.number ?? ''), x, cy, font(size, 600, true), C.dim) + 8 * s;
      const where = onAir.get(id);
      const tagW = where ? 80 * s : next.has(id) ? 50 * s : 0;
      x += text(nameOf(id), x, cy, font(size, 600), C.text, Math.max(10, lx + lw - x - tagW - 8 * s)) + 8 * s;
      if (where) tag(where.join(' + '), x, cy, C.pgmBright, C.text);
      else if (next.has(id)) tag('NEXT', x, cy, C.pvwBright, C.pvwInk);
    } else {
      const sc = t.content.id;
      const label = t.content.type === 'program' ? 'ON AIR' : 'NEXT';
      // The tally block at the start of the strip.
      ctx.font = font(11, 700, true);
      const bw = ctx.measureText(label).width + 20 * s;
      ctx.fillStyle = t.content.type === 'program' ? C.pgm : C.pvw;
      ctx.fillRect(lx, ly + 3 * s, bw, lh - 3 * s);
      text(label, lx + 10 * s, cy, font(11, 700, true), C.text);
      x = lx + bw + 8 * s;
      x += text(sc === 'live' ? 'LIVE' : 'BACK', x, cy, font(size, 600, true), C.dim) + 8 * s;
      ctx.font = font(12, 500, true);
      const tcw = t.timecode ? t.timecode[2] - 8 * s : ctx.measureText(clock).width;
      const scr = show.screens[sc];
      text(nameOf(t.content.type === 'program' ? scr.program : scr.preview), x, cy, font(size, 600), C.text, Math.max(10, lx + lw - x - tcw - 24 * s));
      // The engine's timecode (with frames) is the small plane `tc2`, drawn there every frame.
      if (!t.timecode) text(clock, lx + lw - 8 * s - tcw, cy, font(12, 500, true), C.faint);
    }
    ctx.restore();
  }
}
