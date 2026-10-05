import type { Title } from './model/project';

/** How long a title takes to fade in and out (ms). */
export const TITLE_FADE = 400;

/** How see-through a title is at a moment of it (0 to 1). */
export function titleAlpha(into: number, length: number): number {
  if (into < 0 || into > length) return 0;
  return Math.max(0, Math.min(1, into / TITLE_FADE, (length - into) / TITLE_FADE));
}

function fit(ctx: CanvasRenderingContext2D, text: string, size: number, weight: number, most: number): number {
  let s = size;
  ctx.font = `${weight} ${s}px 'Segoe UI', system-ui, sans-serif`;
  while (s > 8 && ctx.measureText(text).width > most) {
    s -= 1;
    ctx.font = `${weight} ${s}px 'Segoe UI', system-ui, sans-serif`;
  }
  return s;
}

/** Draw a title over a picture `w`×`h` (the same drawing goes into the film). */
export function drawTitle(ctx: CanvasRenderingContext2D, t: Title, w: number, h: number, alpha = 1): void {
  if (alpha <= 0 || (!t.text.trim() && !t.sub.trim())) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'alphabetic';
  if (t.style === 'center') {
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = h * 0.02;
    const big = fit(ctx, t.text, Math.round(h * 0.075), 600, w * 0.86);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(t.text, w / 2, h * 0.5);
    if (t.sub.trim()) {
      fit(ctx, t.sub, Math.round(h * 0.036), 400, w * 0.8);
      ctx.fillStyle = '#dfe3e8';
      ctx.fillText(t.sub, w / 2, h * 0.5 + big * 0.95);
    }
  } else {
    const corner = t.style === 'corner';
    const nameSize = Math.round(h * (corner ? 0.032 : 0.046));
    const subSize = Math.round(h * (corner ? 0.024 : 0.03));
    const pad = Math.round(h * 0.022);
    const most = w * (corner ? 0.4 : 0.6);
    const ns = fit(ctx, t.text, nameSize, 600, most);
    const nameW = ctx.measureText(t.text).width;
    let subW = 0;
    let ss = subSize;
    if (t.sub.trim()) {
      ss = fit(ctx, t.sub, subSize, 400, most);
      subW = ctx.measureText(t.sub).width;
    }
    const boxW = Math.max(nameW, subW) + pad * 2 + h * 0.008;
    const boxH = pad * 2 + ns + (t.sub.trim() ? ss * 1.25 : 0);
    const x = Math.round(w * (corner ? 0.04 : 0.06));
    const y = corner ? Math.round(h * 0.06) : Math.round(h * 0.9 - boxH);
    ctx.fillStyle = 'rgba(16,18,22,0.84)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = '#4fb3bf';
    ctx.fillRect(x, y, Math.max(3, Math.round(h * 0.006)), boxH);
    const tx = x + pad + h * 0.008;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${ns}px 'Segoe UI', system-ui, sans-serif`;
    ctx.fillText(t.text, tx, y + pad + ns * 0.82);
    if (t.sub.trim()) {
      ctx.fillStyle = '#c9ced5';
      ctx.font = `400 ${ss}px 'Segoe UI', system-ui, sans-serif`;
      ctx.fillText(t.sub, tx, y + pad + ns + ss * 1.05);
    }
  }
  ctx.restore();
}

/** A title as a see-through PNG the size of the film (base64, for the export). */
export function titlePng(t: Title, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) drawTitle(ctx, t, w, h, 1);
  return c.toDataURL('image/png').split(',')[1] ?? '';
}
