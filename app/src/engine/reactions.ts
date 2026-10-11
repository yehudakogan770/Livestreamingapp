// Reactions from phones floating up over the picture (mirrors
// crates/engine/src/reactions.rs). Drawn the same way in the control window
// (ReactionsView) and on the screens (compositor.ts), by `drawReactions`.

import type { Reactions } from './types/Reactions';
import type { ReactionFloat } from './types/ReactionFloat';

/** Love, Haha, Wow, Yes: what each is called, and its badge's color. */
export const REACTIONS = [
  { name: 'Love', color: '#e8445a' },
  { name: 'Haha', color: '#f2b52c' },
  { name: 'Wow', color: '#f2b52c' },
  { name: 'Yes', color: '#2ea56a' },
] as const;

/** How long a reaction floats, ms. */
export const FLOAT_MS = 4000;

export function defaultReactions(): Reactions {
  return {
    open: false,
    counts: [0, 0, 0, 0],
    floating: [],
    side: 'right',
    showCounts: false,
    nextSeed: 0,
    joinUrl: '',
    joinQr: '',
    showJoin: true,
  };
}

export function repairReactions(r: Reactions): void {
  r.counts = [0, 1, 2, 3].map((i) => r.counts?.[i] ?? 0);
  r.floating = (r.floating ?? []).filter((f) => f.kind < 4).slice(-48);
  r.joinUrl = [...(r.joinUrl ?? '')].slice(0, 200).join('');
  if ((r.joinQr ?? '').length > 200_000 || !(r.joinQr ?? '').trimStart().startsWith('<svg')) r.joinQr = '';
}

/** A batch of taps (mirrors `Reactions::react`): all counted, up to 12 float up. */
export function react(r: Reactions, taps: number[], now: number): boolean {
  if (!r.open) return false;
  r.floating = r.floating.filter((f) => now - f.at < FLOAT_MS);
  const t = [0, 1, 2, 3].map((k) => Math.min(100_000, Math.max(0, Math.floor(taps[k] ?? 0))));
  const total = t.reduce((a, b) => a + b, 0);
  if (!total) return true;
  r.counts = r.counts.map((c, k) => c + t[k]!);
  const room = Math.min(12, total);
  const drawn = t.map((n) => (n ? Math.max(1, Math.floor((n * room) / total)) : 0));
  while (drawn.reduce((a, b) => a + b, 0) > room) drawn[drawn.indexOf(Math.max(...drawn))]! -= 1;
  let i = 0;
  drawn.forEach((n, kind) => {
    for (let j = 0; j < n; j++) {
      r.nextSeed = (Math.imul(r.nextSeed, 1_103_515_245) + 12_345) >>> 0;
      r.floating.push({ kind, at: now + i * 60, seed: r.nextSeed });
      i++;
    }
  });
  if (r.floating.length > 48) r.floating = r.floating.slice(-48);
  return true;
}

/** A number from 0 to 1 from a seed (the same everywhere). */
const unit = (seed: number, salt: number) => {
  let x = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff;
};

/** Where and how a floating reaction is at `now` (null: not showing). Sizes are fractions of the frame height. */
export function floatAt(f: ReactionFloat, side: Reactions['side'], now: number, w: number, h: number) {
  const t = now - f.at;
  if (t < 0 || t >= FLOAT_MS) return null;
  const p = t / FLOAT_MS;
  const column = side === 'left' ? h * 0.16 : w - h * 0.16;
  const spread = (unit(f.seed, 1) - 0.5) * h * 0.14;
  const sway = Math.sin(p * Math.PI * (2 + unit(f.seed, 2) * 2) + unit(f.seed, 3) * 6.28) * h * 0.025;
  const rise = 1 - (1 - p) * (1 - p);
  const y = h * (0.9 - 0.62 * rise);
  const pop = Math.min(1, t / 220);
  const scale = (0.5 + 0.5 * pop) * (0.85 + unit(f.seed, 4) * 0.35);
  const alpha = p < 0.65 ? 1 : Math.max(0, 1 - (p - 0.65) / 0.35);
  return { x: column + spread + sway, y, r: h * 0.032 * scale, alpha };
}

/** One reaction's badge: a colored disc with its sign in white (or dark on yellow). */
export function drawBadge(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, r: number): void {
  const look = REACTIONS[kind] ?? REACTIONS[0];
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = look.color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  const s = r / 12;
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 0) {
    // A heart.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, 6.5);
    ctx.bezierCurveTo(-7.5, 1.5, -7.5, -5.5, -3.6, -5.6);
    ctx.bezierCurveTo(-1.6, -5.7, -0.4, -4.4, 0, -3);
    ctx.bezierCurveTo(0.4, -4.4, 1.6, -5.7, 3.6, -5.6);
    ctx.bezierCurveTo(7.5, -5.5, 7.5, 1.5, 0, 6.5);
    ctx.fill();
  } else if (kind === 3) {
    // A tick.
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-5, 0.5);
    ctx.lineTo(-1.5, 4);
    ctx.lineTo(5.5, -3.5);
    ctx.stroke();
  } else {
    // A face: smiling (Haha) or surprised (Wow).
    ctx.fillStyle = '#3a2a05';
    ctx.strokeStyle = '#3a2a05';
    ctx.lineWidth = 1.8;
    for (const ex of [-3.4, 3.4]) {
      ctx.beginPath();
      ctx.arc(ex, -2.8, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    if (kind === 1) ctx.arc(0, 0.8, 4.6, 0.15 * Math.PI, 0.85 * Math.PI);
    else ctx.ellipse(0, 3.6, 2.2, 2.8, 0, 0, Math.PI * 2);
    if (kind === 1) ctx.stroke();
    else ctx.fill();
  }
  ctx.restore();
}

/**
 * Reactions over a transparent picture of `w` × `h`: those floating now,
 * the totals (when shown) and a small code to scan (while open).
 */
export function drawReactions(
  ctx: CanvasRenderingContext2D,
  r: Reactions,
  now: number,
  w: number,
  h: number,
  join: { img: HTMLImageElement | null; label: string } | null = null,
): void {
  for (const f of r.floating) {
    const at = floatAt(f, r.side, now, w, h);
    if (!at) continue;
    ctx.save();
    ctx.globalAlpha = at.alpha;
    drawBadge(ctx, f.kind, at.x, at.y, at.r);
    ctx.restore();
  }
  const u = h / 100;
  const column = r.side === 'left' ? h * 0.16 : w - h * 0.16;
  if (r.showCounts) {
    // The totals: a row of badges with numbers, under the column.
    ctx.save();
    ctx.font = `700 ${2.6 * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const cell = 11 * u;
    const x0 = Math.max(2 * u, Math.min(w - 4 * cell - 2 * u, column - 2 * cell));
    const y = h - 5 * u;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(x0 - 1.2 * u, y - 2.6 * u, 4 * cell + 1.4 * u, 5.2 * u, 2.6 * u);
    ctx.fill();
    r.counts.forEach((c, k) => {
      const x = x0 + k * cell;
      drawBadge(ctx, k, x + 1.8 * u, y, 1.8 * u);
      ctx.fillStyle = '#fff';
      ctx.fillText(compact(c), x + 4.2 * u, y, cell - 4.6 * u);
    });
    ctx.restore();
  }
  if (join && r.open) {
    const size = 15 * u;
    const x = r.side === 'left' ? w - size - 3 * u : 3 * u;
    const y = h - size - 7 * u;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, u);
    ctx.fill();
    if (join.img?.complete && join.img.naturalWidth) ctx.drawImage(join.img, x + u, y + u, size - 2 * u, size - 2 * u);
    ctx.font = `700 ${2.2 * u}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(x, y + size + 0.8 * u, size, 3.6 * u, u);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(join.label, x + size / 2, y + size + 2.6 * u, size - u);
    ctx.restore();
  }
}

/** 1234 → "1.2K", 1500000 → "1.5M". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(Math.floor(n / 100) / 10).toString()}K`;
  return `${(Math.floor(n / 100_000) / 10).toString()}M`;
}

/** Anything still floating at `now` (the picture changes while so). */
export const floating = (r: Reactions, now: number): boolean => r.floating.some((f) => now - f.at < FLOAT_MS && now >= f.at - 1000);
