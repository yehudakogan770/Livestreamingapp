// What each painting tool does to the pixels under its coverage (see
// core/brush.ts): paint with a blend mode, erase, clone from a source, the
// history brush and pattern stamp, blur, sharpen, smudge, dodge, burn,
// sponge, color replacement and the background eraser.

import { compositePixel, type PaintMode } from '../../core/blend';
import { gaussianBlur, type Img } from '../../core/img';
import { rgbToHsl, hslToRgb, lum } from '../../core/color';
import { getPattern, patternAt } from '../../core/patterns';
import type { BrushStroke, Dab, PixelOp } from '../../core/brush';
import type { Raster } from '../../core/raster';
import type { Rect } from '../../core/types';

/** Paint a color with a mode (Behind and Clear included). One-channel targets (masks) get the color's gray. */
export function paintOp(color: [number, number, number], mode: PaintMode, channels: 1 | 4, lockAlpha: boolean): PixelOp {
  const gray = lum(color[0], color[1], color[2]);
  return {
    apply(r, orig, cov, out) {
      const n = r.w * r.h;
      if (channels === 1) {
        for (let i = 0; i < n; i++) {
          const c = cov[i]!;
          out[i] = mode === 'clear' ? orig[i]! * (1 - c) : orig[i]! + (gray - orig[i]!) * c;
        }
        return;
      }
      out.set(orig);
      for (let i = 0; i < n; i++) {
        const c = cov[i]!;
        if (c <= 0) continue;
        const o = i * 4;
        const a0 = orig[o + 3]!;
        if (mode === 'clear') {
          out[o + 3] = a0 * (1 - c);
          continue;
        }
        if (mode === 'behind') {
          // The paint goes under what is there.
          const ab = c,
            as = a0;
          const ao = as + ab * (1 - as);
          if (ao > 0) for (let k = 0; k < 3; k++) out[o + k] = (orig[o + k]! * as + color[k]! * ab * (1 - as)) / ao;
          out[o + 3] = ao;
          continue;
        }
        compositePixel(mode, out, o, color[0], color[1], color[2], c, r.x + (i % r.w), r.y + ((i / r.w) | 0));
        if (lockAlpha) out[o + 3] = a0;
      }
    },
  };
}

/** The Eraser: takes alpha away (on the Background or with transparency locked, paints the background color). */
export function eraseOp(channels: 1 | 4, toColor: [number, number, number] | null): PixelOp {
  return {
    apply(r, orig, cov, out) {
      const n = r.w * r.h;
      if (channels === 1) {
        const g = toColor ? lum(toColor[0], toColor[1], toColor[2]) : 0;
        for (let i = 0; i < n; i++) out[i] = orig[i]! + (g - orig[i]!) * cov[i]!;
        return;
      }
      out.set(orig);
      for (let i = 0; i < n; i++) {
        const c = cov[i]!;
        if (c <= 0) continue;
        const o = i * 4;
        if (toColor) for (let k = 0; k < 3; k++) out[o + k] = orig[o + k]! + (toColor[k]! - orig[o + k]!) * c;
        else out[o + 3] = orig[o + 3]! * (1 - c);
      }
    },
  };
}

/** Pixels from a source at an offset (Clone Stamp, Healing Brush during the stroke). */
export function cloneOp(read: (r: Rect) => Float32Array, dx: number, dy: number, channels: 1 | 4, mode: PaintMode = 'normal'): PixelOp {
  return {
    apply(r, orig, cov, out) {
      const src = read({ x: r.x - dx, y: r.y - dy, w: r.w, h: r.h });
      const n = r.w * r.h;
      if (channels === 1) {
        for (let i = 0; i < n; i++) out[i] = orig[i]! + (lum(src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!) - orig[i]!) * cov[i]!;
        return;
      }
      out.set(orig);
      for (let i = 0; i < n; i++) {
        const c = cov[i]!;
        if (c <= 0) continue;
        const o = i * 4;
        compositePixel(mode as never, out, o, src[o]!, src[o + 1]!, src[o + 2]!, src[o + 3]! * c, r.x + (i % r.w), r.y + ((i / r.w) | 0));
      }
    },
  };
}

export function patternOp(id: string, scale: number, ox: number, oy: number): PixelOp {
  const p = getPattern(id);
  const tmp = [0, 0, 0, 0];
  return {
    apply(r, orig, cov, out) {
      out.set(orig);
      for (let i = 0; i < r.w * r.h; i++) {
        const c = cov[i]!;
        if (c <= 0) continue;
        patternAt(p, r.x + (i % r.w) - ox, r.y + ((i / r.w) | 0) - oy, scale, tmp);
        compositePixel('normal', out, i * 4, tmp[0]!, tmp[1]!, tmp[2]!, tmp[3]! * c);
      }
    },
  };
}

/** The History Brush: paint from an earlier state of the same layer. */
export function historyOp(source: Raster): PixelOp {
  return {
    apply(r, orig, cov, out) {
      const src = source.read(r);
      const ch = source.channels;
      for (let i = 0; i < r.w * r.h; i++) {
        const c = cov[i]!;
        for (let k = 0; k < ch; k++) out[i * ch + k] = orig[i * ch + k]! + (src[i * ch + k]! - orig[i * ch + k]!) * c;
      }
    },
  };
}

/** Blur or Sharpen under the brush. */
export function focusOp(stroke: () => BrushStroke, kind: 'blur' | 'sharpen', strength: number, size: number): PixelOp {
  return {
    apply(r, orig, cov, out) {
      const pad = Math.ceil(size * 0.15) + 3;
      const pr = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
      const big: Img = { w: pr.w, h: pr.h, c: 4, data: stroke().readOriginal(pr) };
      const radius = Math.max(0.5, size * 0.05 * (0.5 + strength));
      const bl = gaussianBlur(big, radius);
      out.set(orig);
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const i = y * r.w + x;
          const c = cov[i]! * strength;
          if (c <= 0) continue;
          const bi = ((y + pad) * pr.w + (x + pad)) * 4;
          for (let k = 0; k < 3; k++) {
            const o = orig[i * 4 + k]!;
            const v = kind === 'blur' ? bl.data[bi + k]! : Math.min(1, Math.max(0, o + (o - bl.data[bi + k]!) * 1.5));
            out[i * 4 + k] = o + (v - o) * c;
          }
          if (kind === 'blur') out[i * 4 + 3] = orig[i * 4 + 3]! + (bl.data[bi + 3]! - orig[i * 4 + 3]!) * c;
        }
    },
  };
}

/** Dodge (lighten), Burn (darken) or Sponge (saturation) by tonal range. */
export function toneOp(kind: 'dodge' | 'burn' | 'sponge', range: 'shadows' | 'midtones' | 'highlights', exposure: number, protect: boolean, sponge: 'saturate' | 'desaturate'): PixelOp {
  const weight = (l: number) => (range === 'shadows' ? (1 - l) * (1 - l) : range === 'highlights' ? l * l : 4 * l * (1 - l));
  return {
    apply(r, orig, cov, out) {
      out.set(orig);
      for (let i = 0; i < r.w * r.h; i++) {
        const c = cov[i]! * exposure;
        if (c <= 0) continue;
        const o = i * 4;
        const R = orig[o]!,
          G = orig[o + 1]!,
          B = orig[o + 2]!;
        if (kind === 'sponge') {
          const [h, s, l] = rgbToHsl(R, G, B);
          const ns = sponge === 'saturate' ? s + (1 - s) * c * 0.8 : s * (1 - c * 0.8);
          const v = hslToRgb(h, Math.min(1, Math.max(0, ns)), l);
          out[o] = v[0];
          out[o + 1] = v[1];
          out[o + 2] = v[2];
          continue;
        }
        const l = lum(R, G, B);
        const w = weight(l) * c;
        if (protect) {
          // Keep hue and saturation: scale the color by the luminance change.
          const nl = kind === 'dodge' ? l + (1 - l) * w : l * (1 - w);
          const k = l > 1e-4 ? nl / l : 0;
          out[o] = Math.min(1, R * k + (l <= 1e-4 ? nl : 0));
          out[o + 1] = Math.min(1, G * k + (l <= 1e-4 ? nl : 0));
          out[o + 2] = Math.min(1, B * k + (l <= 1e-4 ? nl : 0));
        } else
          for (let k = 0; k < 3; k++) {
            const v = orig[o + k]!;
            out[o + k] = kind === 'dodge' ? v + (1 - v) * w : v * (1 - w);
          }
      }
    },
  };
}

/** Color Replacement: pixels close to the color under the brush's center take the paint's hue / color. */
export function colorReplaceOp(stroke: () => BrushStroke, color: [number, number, number], mode: 'hue' | 'saturation' | 'color' | 'luminosity', tolerance: number): PixelOp {
  const [th, ts, tl] = rgbToHsl(color[0], color[1], color[2]);
  return {
    apply(r, orig, cov, out) {
      out.set(orig);
      const d = stroke().lastDab;
      if (!d) return;
      const ref = stroke().readOriginal({ x: Math.floor(d.x), y: Math.floor(d.y), w: 1, h: 1 });
      const tol = tolerance / 255;
      for (let i = 0; i < r.w * r.h; i++) {
        const c = cov[i]!;
        if (c <= 0) continue;
        const o = i * 4;
        const diff = Math.max(Math.abs(orig[o]! - ref[0]!), Math.abs(orig[o + 1]! - ref[1]!), Math.abs(orig[o + 2]! - ref[2]!));
        if (diff > tol) continue;
        const [h, s, l] = rgbToHsl(orig[o]!, orig[o + 1]!, orig[o + 2]!);
        const v = mode === 'hue' ? hslToRgb(th, s, l) : mode === 'saturation' ? hslToRgb(h, ts, l) : mode === 'luminosity' ? hslToRgb(h, s, tl) : hslToRgb(th, ts, l);
        for (let k = 0; k < 3; k++) out[o + k] = orig[o + k]! + (v[k]! - orig[o + k]!) * c;
      }
    },
  };
}

/** Background Eraser: erases pixels close to the color under the brush's center (sampled continuously). */
export function bgEraseOp(stroke: () => BrushStroke, tolerance: number, protect: [number, number, number] | null): PixelOp {
  return {
    apply(r, orig, cov, out) {
      out.set(orig);
      const d = stroke().lastDab;
      if (!d) return;
      const ref = stroke().readOriginal({ x: Math.floor(d.x), y: Math.floor(d.y), w: 1, h: 1 });
      const tol = tolerance / 255;
      for (let i = 0; i < r.w * r.h; i++) {
        const c = cov[i]!;
        if (c <= 0) continue;
        const o = i * 4;
        const diff = Math.max(Math.abs(orig[o]! - ref[0]!), Math.abs(orig[o + 1]! - ref[1]!), Math.abs(orig[o + 2]! - ref[2]!));
        if (protect && Math.max(Math.abs(orig[o]! - protect[0]), Math.abs(orig[o + 1]! - protect[1]), Math.abs(orig[o + 2]! - protect[2])) < 0.08) continue;
        // Soft edge near the tolerance.
        const k = diff <= tol * 0.7 ? 1 : diff >= tol ? 0 : 1 - (diff - tol * 0.7) / (tol * 0.3);
        out[o + 3] = orig[o + 3]! * (1 - c * k);
      }
    },
  };
}

/** Smudge and the Mixer Brush: color carried from dab to dab. */
export function smudgeOp(strength: number, finger: [number, number, number] | null, mixer: { wet: number; load: number; mix: number; color: [number, number, number] } | null): PixelOp {
  let carry: Float32Array | null = null;
  let carrySize = 0;
  return {
    apply(_r, orig, _cov, out) {
      out.set(orig);
    },
    perDab(d: Dab, st: BrushStroke) {
      const size = Math.max(2, Math.ceil(d.size));
      const half = size / 2;
      const r = { x: Math.floor(d.x - half), y: Math.floor(d.y - half), w: size, h: size };
      const cur = st.readCurrent(r);
      if (!carry || carrySize !== size) {
        carry = cur.slice();
        carrySize = size;
        if (finger) for (let i = 0; i < size * size; i++) carry.set([finger[0], finger[1], finger[2], 1], i * 4);
        if (mixer) for (let i = 0; i < size * size; i++) for (let k = 0; k < 3; k++) carry[i * 4 + k] = carry[i * 4 + k]! * (1 - mixer.load) + mixer.color[k]! * mixer.load;
        return;
      }
      const tip = st.o.tip;
      const next = cur.slice();
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const dx = r.x + x + 0.5 - d.x,
            dy = r.y + y + 0.5 - d.y;
          const dist = Math.hypot(dx, dy) / half;
          if (dist >= 1) continue;
          const a = dist <= tip.hardness ? 1 : 1 - (dist - tip.hardness) / Math.max(0.001, 1 - tip.hardness);
          const k = a * strength * d.flow;
          if (st.o.selection && st.o.selection(r.x + x, r.y + y) <= 0) continue;
          for (let c = 0; c < 4; c++) next[i * 4 + c] = cur[i * 4 + c]! + (carry[i * 4 + c]! - cur[i * 4 + c]!) * k;
          // The carried paint picks up what it passes over.
          const pick = mixer ? mixer.wet : 1 - strength * 0.9;
          for (let c = 0; c < 4; c++) carry[i * 4 + c] = carry[i * 4 + c]! + (cur[i * 4 + c]! - carry[i * 4 + c]!) * pick * a;
          if (mixer) for (let c = 0; c < 3; c++) carry[i * 4 + c] = carry[i * 4 + c]! + (mixer.color[c]! - carry[i * 4 + c]!) * mixer.load * 0.05;
        }
      st.writeCurrent(r, next);
      st.markTouched(r);
    },
  };
}
