// Distort: Displace, Pinch, Polar Coordinates, Ripple, Spherize, Twirl,
// Wave, ZigZag, and Lens Correction. Each maps output pixels back to where
// they come from in the source (inverse mapping, bilinear).

import { img, sampleBilinear, type Img } from '../img';
import type { FilterDef, FilterContext } from './types';
import { num, str, bool, vec } from './types';

/** Build an image by asking, for each output pixel (whole-picture coords), where to read. */
function remap(a: Img, ctx: FilterContext, f: (X: number, Y: number, out: number[]) => boolean, edge: 'clamp' | 'transparent' | 'wrap' = 'clamp'): Img {
  const out = img(a.w, a.h, 4);
  const ox = ctx.ox ?? 0,
    oy = ctx.oy ?? 0;
  const q = [0, 0];
  const s = [0, 0, 0, 0];
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const X = x + ox + 0.5,
        Y = y + oy + 0.5;
      if (!f(X, Y, q)) {
        out.data.set(a.data.subarray((y * a.w + x) * 4, (y * a.w + x) * 4 + 4), (y * a.w + x) * 4);
        continue;
      }
      let sx = q[0]! - ox,
        sy = q[1]! - oy;
      if (edge === 'wrap') {
        sx = ((sx % a.w) + a.w) % a.w;
        sy = ((sy % a.h) + a.h) % a.h;
      } else if (edge === 'transparent' && (sx < 0 || sy < 0 || sx > a.w || sy > a.h)) continue;
      sampleBilinear(a, sx, sy, s);
      out.data.set(s, (y * a.w + x) * 4);
    }
  return out;
}

export const DISTORT_FILTERS: FilterDef[] = [
  {
    id: 'displace',
    name: 'Displace',
    menu: 'Distort',
    params: [
      { key: 'hscale', label: 'Horizontal Scale', type: 'number', min: -999, max: 999, def: 10, unit: '%' },
      { key: 'vscale', label: 'Vertical Scale', type: 'number', min: -999, max: 999, def: 10, unit: '%' },
      { key: 'wrap', label: 'Wrap Around (else repeat edge pixels)', type: 'bool', def: false },
    ],
    run: (a, p, c) => {
      const map = c.extra?.map;
      if (!map) return a;
      const hs = (num(p, 'hscale', 10) / 100) * 128,
        vs = (num(p, 'vscale', 10) / 100) * 128;
      const ox = c.ox ?? 0,
        oy = c.oy ?? 0;
      // The map is stretched over the whole picture; red moves across, green up and down (gray: none).
      return remap(
        a,
        c,
        (X, Y, o) => {
          const mx = Math.min(map.w - 1, Math.max(0, Math.floor(((X - 0.5) / c.width) * map.w))),
            my = Math.min(map.h - 1, Math.max(0, Math.floor(((Y - 0.5) / c.height) * map.h)));
          const i = (my * map.w + mx) * 4;
          o[0] = X + (map.data[i]! - 0.5) * 2 * hs;
          o[1] = Y + (map.data[i + 1]! - 0.5) * 2 * vs;
          void ox;
          void oy;
          return true;
        },
        bool(p, 'wrap') ? 'wrap' : 'clamp',
      );
    },
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
  {
    id: 'pinch',
    name: 'Pinch',
    menu: 'Distort',
    params: [{ key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, def: 50, unit: '%' }],
    run: (a, p, c) => {
      const k = num(p, 'amount', 50) / 100;
      const cx = c.width / 2,
        cy = c.height / 2,
        R = Math.min(c.width, c.height) / 2;
      return remap(a, c, (X, Y, o) => {
        const dx = (X - cx) / R,
          dy = (Y - cy) / R;
        const d = Math.hypot(dx, dy);
        if (d >= 1 || d === 0) return false;
        const f = Math.pow(Math.sin((Math.PI / 2) * d), -k) * d;
        o[0] = cx + (dx / d) * f * R;
        o[1] = cy + (dy / d) * f * R;
        return true;
      });
    },
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
  {
    id: 'polar',
    name: 'Polar Coordinates',
    menu: 'Distort',
    params: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          ['toPolar', 'Rectangular to Polar'],
          ['toRect', 'Polar to Rectangular'],
        ],
        def: 'toPolar',
      },
    ],
    run: (a, p, c) => {
      const cx = c.width / 2,
        cy = c.height / 2;
      const R = Math.min(c.width, c.height) / 2;
      const toPolar = str(p, 'mode', 'toPolar') === 'toPolar';
      return remap(
        a,
        c,
        (X, Y, o) => {
          if (toPolar) {
            const dx = X - cx,
              dy = Y - cy;
            const ang = Math.atan2(dx, -dy);
            o[0] = ((ang + Math.PI) / (2 * Math.PI)) * c.width;
            o[1] = (Math.hypot(dx * (c.height / c.width), dy) / R) * c.height;
          } else {
            const ang = (X / c.width) * 2 * Math.PI - Math.PI;
            const r = (Y / c.height) * R;
            o[0] = cx + Math.sin(ang) * r * (c.width / c.height);
            o[1] = cy - Math.cos(ang) * r;
          }
          return true;
        },
        'clamp',
      );
    },
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
  {
    id: 'ripple',
    name: 'Ripple',
    menu: 'Distort',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: -999, max: 999, def: 100, unit: '%' },
      {
        key: 'size',
        label: 'Size',
        type: 'select',
        options: [
          ['small', 'Small'],
          ['medium', 'Medium'],
          ['large', 'Large'],
        ],
        def: 'medium',
      },
    ],
    run: (a, p, c) => {
      const amp = (num(p, 'amount', 100) / 100) * 3;
      const wl = { small: 8, medium: 16, large: 32 }[str(p, 'size', 'medium') as 'medium'] ?? 16;
      return remap(a, c, (X, Y, o) => {
        o[0] = X + Math.sin((Y / wl) * 2 * Math.PI) * amp;
        o[1] = Y + Math.sin((X / wl) * 2 * Math.PI) * amp;
        return true;
      });
    },
    reach: (p) => Math.ceil(Math.abs(num(p, 'amount', 100)) / 100 * 3) + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'spherize',
    name: 'Spherize',
    menu: 'Distort',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, def: 100, unit: '%' },
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          ['normal', 'Normal'],
          ['horizontal', 'Horizontal Only'],
          ['vertical', 'Vertical Only'],
        ],
        def: 'normal',
      },
    ],
    run: (a, p, c) => {
      const k = num(p, 'amount', 100) / 100;
      const mode = str(p, 'mode', 'normal');
      const cx = c.width / 2,
        cy = c.height / 2;
      return remap(a, c, (X, Y, o) => {
        let dx = (X - cx) / cx,
          dy = (Y - cy) / cy;
        const d = mode === 'horizontal' ? Math.abs(dx) : mode === 'vertical' ? Math.abs(dy) : Math.hypot(dx, dy);
        if (d >= 1 || d === 0) return false;
        // Out of a sphere: arcsin mapping, mixed by amount (negative pinches in).
        const s = k >= 0 ? Math.asin(d) / (Math.PI / 2) / d : Math.sin((d * Math.PI) / 2) / d;
        const f = 1 + (s - 1) * Math.abs(k);
        if (mode !== 'vertical') dx *= f;
        if (mode !== 'horizontal') dy *= f;
        o[0] = cx + dx * cx;
        o[1] = cy + dy * cy;
        return true;
      });
    },
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
  {
    id: 'twirl',
    name: 'Twirl',
    menu: 'Distort',
    params: [{ key: 'angle', label: 'Angle', type: 'number', min: -999, max: 999, def: 50, unit: '°' }],
    run: (a, p, c) => {
      const t = (num(p, 'angle', 50) * Math.PI) / 180;
      const cx = c.width / 2,
        cy = c.height / 2,
        R = Math.min(cx, cy);
      return remap(a, c, (X, Y, o) => {
        const dx = X - cx,
          dy = Y - cy;
        const d = Math.hypot(dx, dy) / R;
        if (d >= 1) return false;
        const th = t * (1 - d) * (1 - d);
        o[0] = cx + dx * Math.cos(th) - dy * Math.sin(th);
        o[1] = cy + dx * Math.sin(th) + dy * Math.cos(th);
        return true;
      });
    },
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
  {
    id: 'wave',
    name: 'Wave',
    menu: 'Distort',
    params: [
      { key: 'wavelength', label: 'Wavelength', type: 'number', min: 2, max: 999, def: 120, unit: 'px' },
      { key: 'amplitude', label: 'Amplitude', type: 'number', min: 1, max: 999, def: 15, unit: 'px' },
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        options: [
          ['sine', 'Sine'],
          ['triangle', 'Triangle'],
          ['square', 'Square'],
        ],
        def: 'sine',
      },
      { key: 'horizontal', label: 'Horizontal scale', type: 'number', min: 0, max: 100, def: 100, unit: '%' },
      { key: 'vertical', label: 'Vertical scale', type: 'number', min: 0, max: 100, def: 100, unit: '%' },
    ],
    run: (a, p, c) => {
      const wl = num(p, 'wavelength', 120),
        amp = num(p, 'amplitude', 15);
      const type = str(p, 'type', 'sine');
      const hs = num(p, 'horizontal', 100) / 100,
        vs = num(p, 'vertical', 100) / 100;
      const wave = (t: number) => {
        const f = ((t % 1) + 1) % 1;
        if (type === 'triangle') return 1 - 4 * Math.abs(f - 0.5);
        if (type === 'square') return f < 0.5 ? 1 : -1;
        return Math.sin(f * 2 * Math.PI);
      };
      return remap(a, c, (X, Y, o) => {
        o[0] = X + wave(Y / wl) * amp * hs;
        o[1] = Y + wave(X / wl + 0.25) * amp * vs;
        return true;
      });
    },
    reach: (p) => Math.ceil(num(p, 'amplitude', 15)) + 2,
    dialog: true,
    smart: true,
  },
  {
    id: 'zigzag',
    name: 'ZigZag',
    menu: 'Distort',
    params: [
      { key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, def: 10 },
      { key: 'ridges', label: 'Ridges', type: 'number', min: 1, max: 20, def: 5 },
    ],
    run: (a, p, c) => {
      const amt = num(p, 'amount', 10) / 100,
        ridges = num(p, 'ridges', 5);
      const cx = c.width / 2,
        cy = c.height / 2,
        R = Math.min(cx, cy);
      return remap(a, c, (X, Y, o) => {
        const dx = X - cx,
          dy = Y - cy;
        const d = Math.hypot(dx, dy) / R;
        if (d >= 1 || d === 0) return false;
        const s = 1 + amt * Math.sin(d * ridges * 2 * Math.PI) * (1 - d) * 0.5;
        o[0] = cx + dx * s;
        o[1] = cy + dy * s;
        return true;
      });
    },
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
  {
    id: 'lensCorrection',
    name: 'Lens Correction',
    menu: '',
    params: [
      { key: 'distortion', label: 'Remove Distortion', type: 'number', min: -100, max: 100, def: 0 },
      { key: 'caRed', label: 'Fix Red/Cyan Fringe', type: 'number', min: -100, max: 100, def: 0 },
      { key: 'caBlue', label: 'Fix Blue/Yellow Fringe', type: 'number', min: -100, max: 100, def: 0 },
      { key: 'vignette', label: 'Vignette Amount', type: 'number', min: -100, max: 100, def: 0 },
      { key: 'vignetteMid', label: 'Vignette Midpoint', type: 'number', min: 0, max: 100, def: 50 },
      { key: 'vertical', label: 'Vertical Perspective', type: 'number', min: -100, max: 100, def: 0 },
      { key: 'horizontal', label: 'Horizontal Perspective', type: 'number', min: -100, max: 100, def: 0 },
      { key: 'angle', label: 'Angle', type: 'number', min: -180, max: 180, step: 0.1, def: 0, unit: '°' },
      { key: 'scale', label: 'Scale', type: 'number', min: 50, max: 150, def: 100, unit: '%' },
    ],
    run: (a, p, c) => lensCorrect(a, p, c),
    reach: () => Infinity,
    dialog: true,
    smart: true,
  },
];

function lensCorrect(a: Img, p: Record<string, unknown>, c: FilterContext): Img {
  const k1 = (num(p, 'distortion') / 100) * 0.3;
  const caR = (num(p, 'caRed') / 100) * 0.004,
    caB = (num(p, 'caBlue') / 100) * 0.004;
  const vig = num(p, 'vignette') / 100,
    mid = num(p, 'vignetteMid', 50) / 100;
  const vp = (num(p, 'vertical') / 100) * 0.0008,
    hp = (num(p, 'horizontal') / 100) * 0.0008;
  const ang = (num(p, 'angle') * Math.PI) / 180;
  const sc = num(p, 'scale', 100) / 100;
  const cx = c.width / 2,
    cy = c.height / 2,
    R = Math.hypot(cx, cy);
  const out = img(a.w, a.h, 4);
  const ox = c.ox ?? 0,
    oy = c.oy ?? 0;
  const s = [0, 0, 0, 0];
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      let X = (x + ox + 0.5 - cx) / sc,
        Y = (y + oy + 0.5 - cy) / sc;
      // Rotation.
      const rx = X * Math.cos(ang) + Y * Math.sin(ang),
        ry = -X * Math.sin(ang) + Y * Math.cos(ang);
      X = rx;
      Y = ry;
      // Perspective (keystone).
      const wv = 1 + vp * Y + hp * X;
      X /= wv;
      Y /= wv;
      const r = Math.hypot(X, Y) / R;
      const f = 1 + k1 * r * r;
      const o = (y * a.w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const cf = ch === 0 ? 1 + caR : ch === 2 ? 1 + caB : 1;
        sampleBilinear(a, cx + X * f * cf - ox, cy + Y * f * cf - oy, s);
        out.data[o + ch] = s[ch]!;
        if (ch === 1) out.data[o + 3] = s[3]!;
      }
      if (vig) {
        const t = Math.max(0, (r - mid * 0.7) / (1 - mid * 0.7));
        const v = vig * t * t;
        for (let ch = 0; ch < 3; ch++) out.data[o + ch] = Math.min(1, Math.max(0, vig > 0 ? out.data[o + ch]! + (1 - out.data[o + ch]!) * v : out.data[o + ch]! * (1 + v)));
      }
    }
  return out;
}

export { vec };
