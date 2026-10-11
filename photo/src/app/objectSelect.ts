// Object Selection and Select Subject, on the computer, without any cloud.
//
// With a box: the colors inside the box's middle and around its edge build a
// foreground and a background model (k-means in Lab), each pixel is scored
// by which it is closer to, the scores are smoothed along the picture's own
// edges (guided filter) and refined a few rounds, and the piece connected to
// the box's middle is kept (holes filled), with its edge refined at full
// size. A click finds the box from the similar colors around the point.

import { emptyMask, magicWand, maskBounds, fillHoles, type Mask } from '../core/selection';
import { guidedFilter } from '../core/selection';
import { rgbToLab } from '../core/color';
import type { Rect } from '../core/types';

interface Src {
  w: number;
  h: number;
  data: Float32Array;
}

function kmeans(pts: Float32Array, n: number, k: number, iters = 8): Float32Array {
  const c = new Float32Array(k * 3);
  if (n === 0) return c;
  for (let i = 0; i < k; i++) {
    const j = Math.floor(((i + 0.5) / k) * n);
    c.set(pts.subarray(j * 3, j * 3 + 3), i * 3);
  }
  const sum = new Float64Array(k * 3),
    cnt = new Uint32Array(k);
  for (let it = 0; it < iters; it++) {
    sum.fill(0);
    cnt.fill(0);
    for (let p = 0; p < n; p++) {
      let best = 0,
        bd = Infinity;
      for (let i = 0; i < k; i++) {
        const d = (pts[p * 3]! - c[i * 3]!) ** 2 + (pts[p * 3 + 1]! - c[i * 3 + 1]!) ** 2 + (pts[p * 3 + 2]! - c[i * 3 + 2]!) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      sum[best * 3]! += pts[p * 3]!;
      sum[best * 3 + 1]! += pts[p * 3 + 1]!;
      sum[best * 3 + 2]! += pts[p * 3 + 2]!;
      cnt[best]!++;
    }
    for (let i = 0; i < k; i++) if (cnt[i]) for (let j = 0; j < 3; j++) c[i * 3 + j] = sum[i * 3 + j]! / cnt[i]!;
  }
  return c;
}

const nearest = (c: Float32Array, k: number, L: number, a: number, b: number) => {
  let bd = Infinity;
  for (let i = 0; i < k; i++) {
    const d = (L - c[i * 3]!) ** 2 + (a - c[i * 3 + 1]!) ** 2 + (b - c[i * 3 + 2]!) ** 2;
    if (d < bd) bd = d;
  }
  return Math.sqrt(bd);
};

/** The object in `rect` (document pixels) as a selection mask the size of the source. */
export function segmentBox(src: Src, rect: Rect): Mask | null {
  const W = src.w,
    H = src.h;
  const pad = Math.round(Math.max(rect.w, rect.h) * 0.12) + 4;
  const cx0 = Math.max(0, Math.floor(rect.x - pad)),
    cy0 = Math.max(0, Math.floor(rect.y - pad));
  const cx1 = Math.min(W, Math.ceil(rect.x + rect.w + pad)),
    cy1 = Math.min(H, Math.ceil(rect.y + rect.h + pad));
  const cw = cx1 - cx0,
    ch = cy1 - cy0;
  if (cw < 8 || ch < 8) return null;
  // Work at up to 400 px.
  const s = Math.min(1, 400 / Math.max(cw, ch));
  const w = Math.max(8, Math.round(cw * s)),
    h = Math.max(8, Math.round(ch * s));
  const lab = new Float32Array(w * h * 3);
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(W - 1, cx0 + Math.floor((x + 0.5) / s)),
        sy = Math.min(H - 1, cy0 + Math.floor((y + 0.5) / s));
      const i = (sy * W + sx) * 4;
      const [L, a, b] = rgbToLab(src.data[i]!, src.data[i + 1]!, src.data[i + 2]!);
      lab.set([L, a * 1.2, b * 1.2], (y * w + x) * 3);
      lum[y * w + x] = L / 100;
    }
  // The box in work coordinates.
  const bx0 = (rect.x - cx0) * s,
    by0 = (rect.y - cy0) * s,
    bx1 = (rect.x + rect.w - cx0) * s,
    by1 = (rect.y + rect.h - cy0) * s;
  const inBox = (x: number, y: number) => x >= bx0 && x < bx1 && y >= by0 && y < by1;
  const inCore = (x: number, y: number) => {
    const mx = (bx1 - bx0) * 0.3,
      my = (by1 - by0) * 0.3;
    return x >= bx0 + mx && x < bx1 - mx && y >= by0 + my && y < by1 - my;
  };
  let p: Float32Array = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[y * w + x] = inCore(x, y) ? 1 : inBox(x, y) ? 0.5 : 0;
  const K = 6;
  for (let round = 0; round < 4; round++) {
    const fg: number[] = [],
      bg: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = p[i]!;
        const c = [lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!];
        if (!inBox(x, y) || v < 0.3) bg.push(...c);
        else if (v > 0.7) fg.push(...c);
      }
    if (fg.length < 9 || bg.length < 9) return null;
    const cf = kmeans(new Float32Array(fg), fg.length / 3, K),
      cb = kmeans(new Float32Array(bg), bg.length / 3, K);
    const q = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!inBox(x, y)) continue;
        const df = nearest(cf, K, lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!),
          db = nearest(cb, K, lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!);
        q[i] = db / (df + db + 1e-6);
      }
    // Smooth along the picture's edges.
    p = guidedFilter(lum, q, w, h, 3, 0.002);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!inBox(x, y)) p[y * w + x] = 0;
  }
  // Keep the piece connected to the middle of the box.
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = p[i]! > 0.5 ? 1 : 0;
  const keep = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inCore(x, y) && bin[y * w + x]) stack.push(y * w + x);
  if (!stack.length) return null;
  while (stack.length) {
    const i = stack.pop()!;
    if (keep[i] || !bin[i]) continue;
    keep[i] = 1;
    const x = i % w,
      y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  const small = fillHoles({ w, h, data: keep.map((v) => v * 255) }, w * h * 0.02);
  // Back to full size, with the edge refined against the full-size picture.
  const fw = cw,
    fh = ch;
  const up = new Float32Array(fw * fh);
  const flum = new Float32Array(fw * fh);
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) * s - 0.5)),
        sy = Math.min(h - 1, Math.max(0, (y + 0.5) * s - 0.5));
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy);
      const x1 = Math.min(w - 1, x0 + 1),
        y1 = Math.min(h - 1, y0 + 1);
      const tx = sx - x0,
        ty = sy - y0;
      const v = (small.data[y0 * w + x0]! * (1 - tx) + small.data[y0 * w + x1]! * tx) * (1 - ty) + (small.data[y1 * w + x0]! * (1 - tx) + small.data[y1 * w + x1]! * tx) * ty;
      up[y * fw + x] = v / 255;
      const i = ((cy0 + y) * W + cx0 + x) * 4;
      flum[y * fw + x] = 0.299 * src.data[i]! + 0.587 * src.data[i + 1]! + 0.114 * src.data[i + 2]!;
    }
  const r = Math.max(2, Math.round(2 / s));
  const refined = guidedFilter(flum, up, fw, fh, r, 0.001);
  const out = emptyMask(W, H);
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      // Sharpen the soft band a little so edges aren't mushy.
      const v = Math.min(1, Math.max(0, (refined[y * fw + x]! - 0.5) * 1.8 + 0.5));
      out.data[(cy0 + y) * W + cx0 + x] = Math.round(v * 255);
    }
  return maskBounds(out) ? out : null;
}

/** Object Selection: a box (or a click, which finds the box) → a mask. */
export async function objectSelect(src: Src, rect: Rect | null, point: [number, number] | null): Promise<Mask | null> {
  if (!rect && point) {
    // The similar colors around the click give the box.
    const wand = magicWand(src, point[0], point[1], 48, true, false);
    const b = maskBounds(wand);
    if (!b) return null;
    const grow = Math.max(b.w, b.h) * 0.15;
    rect = { x: b.x - grow, y: b.y - grow, w: b.w + 2 * grow, h: b.h + 2 * grow };
  }
  if (!rect) return null;
  return segmentBox(src, rect);
}

/**
 * Select Subject: the main thing in the picture. The box is found from where
 * the picture differs most from its edges (a center-weighted contrast map),
 * then segmented like a box drawn by hand.
 */
export function selectSubject(src: Src): Mask | null {
  const W = src.w,
    H = src.h;
  const s = Math.min(1, 200 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * s)),
    h = Math.max(8, Math.round(H * s));
  const lab = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (Math.min(H - 1, Math.floor((y + 0.5) / s)) * W + Math.min(W - 1, Math.floor((x + 0.5) / s))) * 4;
      lab.set(rgbToLab(src.data[i]!, src.data[i + 1]!, src.data[i + 2]!), (y * w + x) * 3);
    }
  // Border colors: what the background probably is.
  const border: number[] = [];
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) border.push(lab[(y * w + x) * 3]!, lab[(y * w + x) * 3 + 1]!, lab[(y * w + x) * 3 + 2]!);
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) border.push(lab[(y * w + x) * 3]!, lab[(y * w + x) * 3 + 1]!, lab[(y * w + x) * 3 + 2]!);
  const cb = kmeans(new Float32Array(border), border.length / 3, 6);
  const sal = new Float32Array(w * h);
  let max = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = nearest(cb, 6, lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!);
      const cw = 1 - Math.min(1, Math.hypot(x / w - 0.5, y / h - 0.5) * 1.4);
      sal[i] = d * (0.4 + 0.6 * cw);
      if (sal[i]! > max) max = sal[i]!;
    }
  if (max <= 0) return null;
  // The box around the salient part (above half the peak, trimmed of outliers).
  const xs: number[] = [],
    ys: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (sal[y * w + x]! > max * 0.45) xs.push(x), ys.push(y);
  if (xs.length < 10) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))]!;
  const x0 = q(xs, 0.02) / s,
    x1 = (q(xs, 0.98) + 1) / s,
    y0 = q(ys, 0.02) / s,
    y1 = (q(ys, 0.98) + 1) / s;
  return segmentBox(src, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}
