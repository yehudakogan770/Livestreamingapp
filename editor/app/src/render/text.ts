import { charLooks, textUnits, type CharLook } from '../model/textanim';
import type { TextAnim, TextData } from '../model/types';

const ease = (x: number): number => 1 - (1 - x) ** 3;

/** How far in (0–1) the words are at a frame, and which animation. */
function phase(t: TextData, local: number, length: number): { anim: TextAnim; k: number } {
  const n = Math.max(1, Math.min(t.animLength, Math.floor(length / 2)));
  if (t.animIn !== 'none' && local < n) return { anim: t.animIn, k: ease(Math.max(0, (local + 1) / n)) };
  if (t.animOut !== 'none' && local >= length - n) return { anim: t.animOut, k: ease(Math.max(0, (length - local - 1) / n)) };
  return { anim: 'none', k: 1 };
}

/** The words with any live parts filled in: {count} (seconds left in the clip) and {clock} (m:ss left). */
export function wordsAt(t: TextData, local: number, length: number, fps = 30): string {
  let words = t.text;
  if (words.includes('{')) {
    const left = Math.max(0, Math.ceil((length - local) / Math.max(1, fps) - 1e-9));
    words = words.replace(/\{count\}/g, String(left)).replace(/\{clock\}/g, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
  }
  return t.caps ? words.toUpperCase() : words;
}

const looks = new WeakMap<TextData, string>();

/**
 * What the words look like at a frame, as a key: the same key means the same
 * picture, so it need not be drawn again. It changes only while the words come
 * on or go off, when they are changed, or when a {count} ticks.
 */
export function textStamp(t: TextData, local: number, length: number, fps = 30): string {
  let base = looks.get(t);
  if (base === undefined) {
    base = JSON.stringify(t);
    looks.set(t, base);
  }
  const { anim } = phase(t, local, length);
  if (anim !== 'none' || t.animators?.some((a) => a.on)) return `${base}|${local}`;
  return t.text.includes('{') ? `${base}|${wordsAt(t, local, length, fps)}` : base;
}

/** A filled box, with rounded corners when asked. */
function fillBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w <= 0 || h <= 0) return;
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr > 0 && typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
    ctx.fill();
  } else ctx.fillRect(x, y, w, h);
}

/** Draw words onto a frame-sized canvas (sizes are for a 1080-high frame). */
export function drawText(ctx: CanvasRenderingContext2D, t: TextData, w: number, h: number, local: number, length: number, fps = 30): void {
  const s = h / 1080;
  const size = t.size * s;
  const { anim, k } = phase(t, local, length);
  const lines = wordsAt(t, local, length, fps).split('\n');
  ctx.save();
  ctx.font = `${t.italic ? 'italic ' : ''}${t.weight} ${size}px "${t.font}", "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${t.tracking * s}px`;
  const lineH = size * t.lineHeight;
  // Later lines are a little smaller (a name, then what they do).
  const sizes = lines.map((_, i) => (i === 0 || t.even ? 1 : 0.62));
  const heights = sizes.map((x) => lineH * x);
  const widths = lines.map((line, i) => {
    ctx.font = `${t.italic ? 'italic ' : ''}${i === 0 || t.even ? t.weight : Math.min(t.weight, 500)} ${size * (sizes[i] ?? 1)}px "${t.font}", "Segoe UI", system-ui, sans-serif`;
    return ctx.measureText(line).width;
  });
  const blockW = Math.max(1, ...widths);
  const blockH = heights.reduce((a, b) => a + b, 0);
  const ax = t.px * w;
  const ay = t.py * h;
  const left = t.align === 'left' ? ax : t.align === 'right' ? ax - blockW : ax - blockW / 2;
  const top = ay - blockH / 2;
  let alpha = 1;
  let dx = 0;
  let dy = 0;
  let scale = 1;
  let reveal = 1;
  let blur = 0;
  const travel = 60 * s;
  if (anim === 'fade') alpha = k;
  else if (anim === 'up') ((dy = (1 - k) * travel), (alpha = k));
  else if (anim === 'down') ((dy = -(1 - k) * travel), (alpha = k));
  else if (anim === 'left') ((dx = (1 - k) * travel), (alpha = k));
  else if (anim === 'right') ((dx = -(1 - k) * travel), (alpha = k));
  else if (anim === 'pop') ((scale = 0.6 + 0.4 * k + Math.sin(k * Math.PI) * 0.08), (alpha = Math.min(1, k * 2)));
  else if (anim === 'type') reveal = k;
  else if (anim === 'blur') ((blur = (1 - k) * 24 * s), (alpha = k));
  else if (anim === 'wipe') reveal = k;
  ctx.globalAlpha = alpha;
  ctx.translate(left + blockW / 2 + dx, top + blockH / 2 + dy);
  ctx.scale(scale, scale);
  ctx.translate(-(left + blockW / 2), -(top + blockH / 2));
  if (blur > 0) ctx.filter = `blur(${blur}px)`;
  const pad = t.box ? t.boxPad * s : 0;
  if (anim === 'wipe') {
    ctx.beginPath();
    ctx.rect(left - pad, top - pad, (blockW + pad * 2) * reveal, blockH + pad * 2);
    ctx.clip();
  }
  // The box (and bar) can grow out from where the words line up.
  const grow = t.boxGrow && anim !== 'none' ? k : 1;
  const bw = (blockW + pad * 2) * grow;
  const bx = t.align === 'left' ? left - pad : t.align === 'right' ? left + blockW + pad - bw : left + blockW / 2 - bw / 2;
  const by = top - pad * 0.7;
  const bh = blockH + pad * 1.4;
  if (t.box) {
    ctx.save();
    ctx.globalAlpha = alpha * (t.boxOpacity / 100);
    ctx.fillStyle = t.boxColor;
    fillBox(ctx, bx, by, bw, bh, (t.boxRadius ?? 0) * s);
    ctx.restore();
  }
  if (t.accent) {
    const a = (t.accentSize ?? 8) * s;
    const gap = t.box ? 0 : 14 * s;
    const side = t.accentSide ?? 'left';
    ctx.save();
    ctx.fillStyle = t.accent;
    if (side === 'left') ctx.fillRect(bx - a - gap, by + (bh * (1 - grow)) / 2, a, bh * grow);
    else if (side === 'right') ctx.fillRect(bx + bw + gap, by + (bh * (1 - grow)) / 2, a, bh * grow);
    else if (side === 'top') ctx.fillRect(bx, by - a - gap, bw, a);
    else ctx.fillRect(bx, by + bh + gap, bw, a);
    ctx.restore();
  }
  // Text animators: each letter drawn on its own, with its own look.
  const looks = t.animators?.some((a) => a.on) ? charLooks(t.animators, textUnits(lines), local) : null;
  let first = 0;
  let y = top;
  lines.forEach((line, i) => {
    const lh = heights[i] ?? lineH;
    const fs = size * (sizes[i] ?? 1);
    ctx.font = `${t.italic ? 'italic ' : ''}${i === 0 || t.even ? t.weight : Math.min(t.weight, 500)} ${fs}px "${t.font}", "Segoe UI", system-ui, sans-serif`;
    const lw = widths[i] ?? 0;
    const x = t.align === 'left' ? left : t.align === 'right' ? left + blockW - lw : left + (blockW - lw) / 2;
    const shown = anim === 'type' ? line.slice(0, Math.round(line.length * reveal)) : line;
    const cy = y + lh / 2;
    const color = i === 0 ? t.color : (t.color2 ?? (t.even ? t.color : mixWhite(t.color)));
    const paint = (words: string, px: number, py: number) => {
      if (t.shadow > 0) {
        ctx.shadowColor = t.shadowColor;
        ctx.shadowBlur = t.shadow * s * 2;
        ctx.shadowOffsetY = t.shadow * s * 0.5;
      }
      if (t.stroke > 0) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = t.stroke * s * 2;
        ctx.strokeStyle = t.strokeColor;
        ctx.strokeText(words, px, py);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = color;
      ctx.fillText(words, px, py);
      ctx.shadowColor = 'transparent';
    };
    const chars = [...line];
    if (looks) drawAnimatedLine(ctx, chars, x, cy, looks.slice(first, first + chars.length), s, t.align, paint);
    else paint(shown, x, cy);
    first += chars.length;
    y += lh;
  });
  ctx.restore();
}

/** One line letter by letter, each with its animators' look (moved, turned, sized, faded, blurred, spaced out). */
function drawAnimatedLine(
  ctx: CanvasRenderingContext2D,
  chars: string[],
  x: number,
  cy: number,
  looks: CharLook[],
  s: number,
  align: TextData['align'],
  paint: (words: string, x: number, y: number) => void,
) {
  const extra = looks.reduce((a, l, i) => (i < looks.length - 1 ? a + l.tracking * s : a), 0);
  const start = x - (align === 'center' ? extra / 2 : align === 'right' ? extra : 0);
  let before = '';
  let spaced = 0;
  const alpha = ctx.globalAlpha;
  const filter = ctx.filter;
  chars.forEach((ch, k) => {
    const look = looks[k] as CharLook;
    const at = start + ctx.measureText(before).width + spaced;
    const cw = ctx.measureText(ch).width;
    before += ch;
    spaced += look.tracking * s;
    if (ch.trim() === '' || look.opacity <= 0.001 || look.scale <= 0.001) return;
    ctx.save();
    ctx.globalAlpha = alpha * Math.min(1, look.opacity);
    ctx.translate(at + cw / 2 + look.x * s, cy + look.y * s);
    if (look.rotation) ctx.rotate((look.rotation * Math.PI) / 180);
    if (look.scale !== 1) ctx.scale(look.scale, look.scale);
    if (look.blur > 0.05) ctx.filter = `blur(${look.blur * s}px)`;
    paint(ch, -cw / 2, 0);
    ctx.filter = filter;
    ctx.restore();
  });
}

/** The second line is the same color, a little softer. */
function mixWhite(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? `${c}d9` : c;
}

export interface TextPreset {
  name: string;
  data: Partial<TextData>;
}

export const TEXT_PRESETS: TextPreset[] = [
  {
    name: 'Lower third',
    data: { text: 'Name\nWhat they do', align: 'left', px: 0.08, py: 0.82, size: 64, box: true, boxOpacity: 70, shadow: 0, animIn: 'right', animOut: 'fade' },
  },
  { name: 'Title', data: { text: 'Title', align: 'center', px: 0.5, py: 0.5, size: 140, weight: 800, animIn: 'pop', animOut: 'fade' } },
  {
    name: 'Subtitle',
    data: {
      text: 'Words spoken',
      align: 'center',
      px: 0.5,
      py: 0.88,
      size: 52,
      weight: 600,
      shadow: 0,
      box: true,
      boxOpacity: 55,
      boxPad: 14,
      animIn: 'none',
      animOut: 'none',
    },
  },
  { name: 'Corner', data: { text: 'Live', align: 'right', px: 0.95, py: 0.08, size: 40, weight: 700, animIn: 'fade', animOut: 'fade' } },
  { name: 'Credits line', data: { text: 'Thank you for watching', align: 'center', px: 0.5, py: 0.5, size: 72, weight: 400, animIn: 'up', animOut: 'fade' } },
  {
    name: 'Big outline',
    data: {
      text: 'WOW',
      align: 'center',
      px: 0.5,
      py: 0.5,
      size: 220,
      weight: 900,
      stroke: 6,
      strokeColor: '#000000',
      shadow: 0,
      animIn: 'pop',
      animOut: 'blur',
    },
  },
];
