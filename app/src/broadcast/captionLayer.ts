// The stream's own copy of the picture, with live captions written on it
// when asked (for sites without closed captions). The recording is drawn
// from the clean picture, so it never has them.

import type { Captions } from '../engine/types/Captions';

/** Words per line for a picture `width` wide at this text size. */
export function lineWidth(width: number, height: number, size: number): number {
  const font = height * 0.045 * size;
  return Math.max(16, Math.floor((width * 0.72) / (font * 0.52)));
}

export class CaptionLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
  }

  /** It can draw here (otherwise the stream uses the plain picture). */
  get works(): boolean {
    return this.ctx !== null;
  }

  /** Copy the picture, and write `lines` on it as `look` says. */
  draw(src: HTMLCanvasElement, lines: string[], look: Captions | null): void {
    const { canvas, ctx } = this;
    if (!ctx) return;
    if (canvas.width !== src.width || canvas.height !== src.height) {
      canvas.width = src.width;
      canvas.height = src.height;
    }
    ctx.drawImage(src, 0, 0);
    if (!look || !lines.length) return;
    const W = canvas.width;
    const H = canvas.height;
    const font = Math.round(H * 0.045 * look.size);
    ctx.font = `600 ${font}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineH = Math.round(font * 1.3);
    const boxW = Math.min(W * 0.9, Math.max(...lines.map((l) => ctx.measureText(l).width)) + font * 1.2);
    const boxH = lineH * lines.length + font * 0.5;
    const y = look.place === 'top' ? H * 0.06 : H - H * 0.07 - boxH;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.beginPath();
    ctx.roundRect((W - boxW) / 2, y, boxW, boxH, font * 0.25);
    ctx.fill();
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + font * 0.25 + lineH * (i + 0.5)));
  }
}
