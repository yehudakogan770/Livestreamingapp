import type { TextAnim, TextData } from '../model/types';

const ease = (x: number): number => 1 - (1 - x) ** 3;

/** How far in (0–1) the words are at a frame, and which animation. */
function phase(t: TextData, local: number, length: number): { anim: TextAnim; k: number } {
  const n = Math.max(1, Math.min(t.animLength, Math.floor(length / 2)));
  if (t.animIn !== 'none' && local < n) return { anim: t.animIn, k: ease(Math.max(0, (local + 1) / n)) };
  if (t.animOut !== 'none' && local >= length - n) return { anim: t.animOut, k: ease(Math.max(0, (length - local - 1) / n)) };
  return { anim: 'none', k: 1 };
}

/** Draw words onto a frame-sized canvas (sizes are for a 1080-high frame). */
export function drawText(ctx: CanvasRenderingContext2D, t: TextData, w: number, h: number, local: number, length: number): void {
  const s = h / 1080;
  const size = t.size * s;
  const { anim, k } = phase(t, local, length);
  const lines = t.text.split('\n');
  ctx.save();
  ctx.font = `${t.italic ? 'italic ' : ''}${t.weight} ${size}px "${t.font}", "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${t.tracking * s}px`;
  const lineH = size * t.lineHeight;
  // Later lines are a little smaller (a name, then what they do).
  const sizes = lines.map((_, i) => (i === 0 ? 1 : 0.62));
  const heights = sizes.map((x) => lineH * x);
  const widths = lines.map((line, i) => {
    ctx.font = `${t.italic ? 'italic ' : ''}${i === 0 ? t.weight : Math.min(t.weight, 500)} ${size * (sizes[i] ?? 1)}px "${t.font}", "Segoe UI", system-ui, sans-serif`;
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
  if (anim === 'wipe') {
    ctx.beginPath();
    const pad = t.box ? t.boxPad * s : 0;
    ctx.rect(left - pad, top - pad, (blockW + pad * 2) * reveal, blockH + pad * 2);
    ctx.clip();
  }
  if (t.box) {
    const pad = t.boxPad * s;
    ctx.save();
    ctx.globalAlpha = alpha * (t.boxOpacity / 100);
    ctx.fillStyle = t.boxColor;
    ctx.fillRect(left - pad, top - pad * 0.7, blockW + pad * 2, blockH + pad * 1.4);
    ctx.restore();
  }
  let y = top;
  lines.forEach((line, i) => {
    const lh = heights[i] ?? lineH;
    const fs = size * (sizes[i] ?? 1);
    ctx.font = `${t.italic ? 'italic ' : ''}${i === 0 ? t.weight : Math.min(t.weight, 500)} ${fs}px "${t.font}", "Segoe UI", system-ui, sans-serif`;
    const lw = widths[i] ?? 0;
    const x = t.align === 'left' ? left : t.align === 'right' ? left + blockW - lw : left + (blockW - lw) / 2;
    const shown = anim === 'type' ? line.slice(0, Math.round(line.length * reveal)) : line;
    const cy = y + lh / 2;
    if (t.shadow > 0) {
      ctx.shadowColor = t.shadowColor;
      ctx.shadowBlur = t.shadow * s * 2;
      ctx.shadowOffsetY = t.shadow * s * 0.5;
    }
    if (t.stroke > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = t.stroke * s * 2;
      ctx.strokeStyle = t.strokeColor;
      ctx.strokeText(shown, x, cy);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = i === 0 ? t.color : mixWhite(t.color);
    ctx.fillText(shown, x, cy);
    ctx.shadowColor = 'transparent';
    y += lh;
  });
  ctx.restore();
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
