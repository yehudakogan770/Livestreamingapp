// The vertical (9:16) version for TikTok, Reels and Shorts: the whole wide
// picture, nothing cut off, across the middle, with a soft blurred copy of it
// filling the space above and below.

/** Where the wide picture goes inside the vertical frame (fitted to its width). */
export function fittedRect(srcW: number, srcH: number, dstW: number, dstH: number): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), w, h };
}

export class VerticalFrame {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** A tiny copy of the picture: stretched up, it is a cheap, smooth blur. */
  private readonly small: HTMLCanvasElement;
  private readonly smallCtx: CanvasRenderingContext2D;

  constructor(width = 1080, height = 1920) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    this.small = document.createElement('canvas');
    this.small.width = 48;
    this.small.height = 27;
    const smallCtx = this.small.getContext('2d', { alpha: false });
    if (!ctx || !smallCtx) throw new Error('This computer cannot draw the vertical picture.');
    this.ctx = ctx;
    this.smallCtx = smallCtx;
  }

  /** Draw the vertical version of `src` (the wide Live Screen). */
  draw(src: HTMLCanvasElement): void {
    const { ctx, canvas, small, smallCtx } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // Behind: the same picture, blurred and darkened, filling the frame.
    smallCtx.imageSmoothingQuality = 'low';
    smallCtx.drawImage(src, 0, 0, small.width, small.height);
    const coverH = H;
    const coverW = (coverH * small.width) / small.height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, (W - coverW) / 2, 0, coverW, coverH);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, W, H);
    // In front: the whole picture, nothing cut off.
    const r = fittedRect(src.width, src.height, W, H);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = Math.round(W * 0.04);
    ctx.drawImage(src, r.x, r.y, r.w, r.h);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}
