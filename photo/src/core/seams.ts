// Content-Aware Scale: seam carving (Avidan & Shamir) — the least important
// paths of pixels are removed (or doubled) so people and buildings keep
// their shape while the picture changes size. A protect mask keeps areas
// whole; skin tones can be protected automatically.

import { resize, type Img } from './img';

function energy(a: Img, protect: Float32Array | null): Float32Array {
  const { w, h } = a;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * a.data[i * 4]! + 0.587 * a.data[i * 4 + 1]! + 0.114 * a.data[i * 4 + 2]! + a.data[i * 4 + 3]! * 0.5;
  const e = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = x > 0 ? L[i - 1]! : L[i]!,
        r = x < w - 1 ? L[i + 1]! : L[i]!;
      const u = y > 0 ? L[i - w]! : L[i]!,
        d = y < h - 1 ? L[i + w]! : L[i]!;
      e[i] = Math.abs(r - l) + Math.abs(d - u) + (protect ? protect[i]! * 1000 : 0);
    }
  return e;
}

/** The lowest-energy top-to-bottom seam (one x per row). */
function findSeam(e: Float32Array, w: number, h: number): Int32Array {
  const M = new Float32Array(w * h);
  M.set(e.subarray(0, w));
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y - 1) * w;
      let m = M[p + x]!;
      if (x > 0 && M[p + x - 1]! < m) m = M[p + x - 1]!;
      if (x < w - 1 && M[p + x + 1]! < m) m = M[p + x + 1]!;
      M[y * w + x] = e[y * w + x]! + m;
    }
  const seam = new Int32Array(h);
  let bx = 0;
  for (let x = 1; x < w; x++) if (M[(h - 1) * w + x]! < M[(h - 1) * w + bx]!) bx = x;
  seam[h - 1] = bx;
  for (let y = h - 2; y >= 0; y--) {
    const x = seam[y + 1]!;
    let best = x;
    if (x > 0 && M[y * w + x - 1]! < M[y * w + best]!) best = x - 1;
    if (x < w - 1 && M[y * w + x + 1]! < M[y * w + best]!) best = x + 1;
    seam[y] = best;
  }
  return seam;
}

function transpose(a: Img): Img {
  const out = { w: a.h, h: a.w, c: a.c, data: new Float32Array(a.data.length) };
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) for (let k = 0; k < a.c; k++) out.data[(x * a.h + y) * a.c + k] = a.data[(y * a.w + x) * a.c + k]!;
  return out;
}

function transposeF(f: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(f.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + y] = f[y * w + x]!;
  return out;
}

/** Narrower or wider by seams (width only). */
function carveWidth(a: Img, target: number, protect: Float32Array | null): Img {
  let cur = a;
  let prot = protect;
  if (target < a.w) {
    while (cur.w > target) {
      const e = energy(cur, prot);
      const seam = findSeam(e, cur.w, cur.h);
      const nw = cur.w - 1;
      const next = new Float32Array(nw * cur.h * 4);
      const np = prot ? new Float32Array(nw * cur.h) : null;
      for (let y = 0; y < cur.h; y++) {
        const sx = seam[y]!;
        const row = cur.data.subarray(y * cur.w * 4, (y + 1) * cur.w * 4);
        next.set(row.subarray(0, sx * 4), y * nw * 4);
        next.set(row.subarray((sx + 1) * 4), y * nw * 4 + sx * 4);
        if (np && prot) {
          const pr = prot.subarray(y * cur.w, (y + 1) * cur.w);
          np.set(pr.subarray(0, sx), y * nw);
          np.set(pr.subarray(sx + 1), y * nw + sx);
        }
      }
      cur = { w: nw, h: cur.h, c: 4, data: next };
      prot = np;
    }
    return cur;
  }
  // Wider: find the seams that would be removed first, then double each.
  const k = target - a.w;
  const order: Int32Array[] = [];
  let tmp = a;
  let tprot = protect;
  // Track original x of each pixel as seams are removed.
  let idx: Int32Array = new Int32Array(a.w * a.h).map((_, i) => i % a.w);
  for (let s = 0; s < Math.min(k, a.w - 1); s++) {
    const e = energy(tmp, tprot);
    const seam = findSeam(e, tmp.w, tmp.h);
    const orig = new Int32Array(tmp.h);
    const nw = tmp.w - 1;
    const next = new Float32Array(nw * tmp.h * 4);
    const nidx = new Int32Array(nw * tmp.h);
    for (let y = 0; y < tmp.h; y++) {
      const sx = seam[y]!;
      orig[y] = idx[y * tmp.w + sx]!;
      const row = tmp.data.subarray(y * tmp.w * 4, (y + 1) * tmp.w * 4);
      next.set(row.subarray(0, sx * 4), y * nw * 4);
      next.set(row.subarray((sx + 1) * 4), y * nw * 4 + sx * 4);
      const ir = idx.subarray(y * tmp.w, (y + 1) * tmp.w);
      nidx.set(ir.subarray(0, sx), y * nw);
      nidx.set(ir.subarray(sx + 1), y * nw + sx);
    }
    order.push(orig);
    tmp = { w: nw, h: tmp.h, c: 4, data: next };
    idx = nidx;
    tprot = null;
  }
  const extra = k - order.length;
  // Insert: each original pixel is repeated as many times as seams went through it.
  const dup = new Uint16Array(a.w * a.h);
  for (const s of order) for (let y = 0; y < a.h; y++) dup[y * a.w + s[y]!]!++;
  const out = new Float32Array(target * a.h * 4);
  for (let y = 0; y < a.h; y++) {
    let ox = 0;
    for (let x = 0; x < a.w && ox < target; x++) {
      const times = 1 + dup[y * a.w + x]!;
      for (let t = 0; t < times && ox < target; t++) {
        // A doubled pixel is the average of itself and its right neighbor (smoother).
        const src = (y * a.w + x) * 4,
          nb = (y * a.w + Math.min(a.w - 1, x + 1)) * 4;
        for (let c = 0; c < 4; c++) out[(y * target + ox) * 4 + c] = t === 0 ? a.data[src + c]! : (a.data[src + c]! + a.data[nb + c]!) / 2;
        ox++;
      }
    }
    // Rounding: fill any remaining columns.
    for (; ox < target; ox++) out.set(out.subarray((y * target + ox - 1) * 4, (y * target + ox) * 4), (y * target + ox) * 4);
  }
  void extra;
  return { w: target, h: a.h, c: 4, data: out };
}

/** Content-aware scale to w × h. `amount` 0..1 mixes with a normal resize (Photoshop's Amount). */
export function contentAwareScale(a: Img, w: number, h: number, protect: Float32Array | null = null, amount = 1): Img {
  // Large pictures are carved at a smaller size, then scaled up (seam search is slow).
  const MAX = 1_500_000;
  let src = a,
    prot = protect;
  let scale = 1;
  if (a.w * a.h > MAX) {
    scale = Math.sqrt(MAX / (a.w * a.h));
    src = resize(a, Math.round(a.w * scale), Math.round(a.h * scale), 'bicubic');
    if (protect) {
      const pi = resize({ w: a.w, h: a.h, c: 1, data: protect }, src.w, src.h, 'bilinear');
      prot = pi.data;
    }
  }
  let tw = Math.max(1, Math.round(w * scale)),
    th = Math.max(1, Math.round(h * scale));
  // Amount below 100 %: part of the change is a plain resize.
  if (amount < 1) {
    const mw = Math.round(src.w + (tw - src.w) * (1 - amount)),
      mh = Math.round(src.h + (th - src.h) * (1 - amount));
    src = resize(src, mw, mh, 'bicubic');
    if (prot) prot = resize({ w: Math.round(a.w * scale), h: Math.round(a.h * scale), c: 1, data: prot }, mw, mh, 'bilinear').data;
  }
  let res = carveWidth(src, tw, prot);
  if (th !== res.h) {
    const t = transpose(res);
    const tp = prot && res.w === src.w ? transposeF(prot, src.w, src.h) : null;
    res = transpose(carveWidth(t, th, tp));
  }
  tw = res.w;
  th = res.h;
  if (scale !== 1 || tw !== w || th !== h) res = resize(res, w, h, 'bicubic');
  return res;
}
