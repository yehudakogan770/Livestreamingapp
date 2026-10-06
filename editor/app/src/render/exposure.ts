// Exposure overlays for the viewer: false color (every brightness band its
// own color, as on cinema cameras and monitors) and zebra stripes over parts
// brighter than a level. Both read the picture as shown (Rec.709 video).

/** How bright a pixel looks, 0–100 (percent of white, like IRE). */
export const lumaPercent = (r: number, g: number, b: number): number => ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * 100;

export interface Band {
  /** Up to this brightness (percent). */
  upTo: number;
  /** A color, or null to show the picture's brightness in gray. */
  color: [number, number, number] | null;
  label: string;
}

/** The false color scale (close to what cinema cameras show). */
export const FALSE_COLOR: Band[] = [
  { upTo: 2.5, color: [120, 40, 170], label: 'Crushed black' },
  { upTo: 10, color: [40, 90, 210], label: 'Near black' },
  { upTo: 38, color: null, label: 'Shadows' },
  { upTo: 44, color: [60, 170, 80], label: 'Middle gray (18%)' },
  { upTo: 52, color: null, label: 'Midtones' },
  { upTo: 56, color: [230, 140, 170], label: 'Skin, one stop over gray' },
  { upTo: 97, color: null, label: 'Highlights' },
  { upTo: 99, color: [235, 215, 60], label: 'Near white' },
  { upTo: Infinity, color: [220, 40, 40], label: 'Clipped' },
];

export const bandOf = (percent: number): Band => FALSE_COLOR.find((b) => percent < b.upTo) ?? (FALSE_COLOR[FALSE_COLOR.length - 1] as Band);

/** The picture in false color (RGBA in, RGBA out, the same size). */
export function falseColor(px: Uint8Array | Uint8ClampedArray, out: Uint8ClampedArray): void {
  for (let i = 0; i < px.length; i += 4) {
    const y = lumaPercent(px[i] as number, px[i + 1] as number, px[i + 2] as number);
    const c = bandOf(y).color;
    if (c) {
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
    } else {
      // Gray at the same brightness, a little darker so the colors stand out.
      const g = Math.round(y * 2.55 * 0.85);
      out[i] = g;
      out[i + 1] = g;
      out[i + 2] = g;
    }
    out[i + 3] = 255;
  }
}

/** Diagonal stripes over every pixel at or above `level` percent (transparent elsewhere). `phase` moves them. */
export function zebra(px: Uint8Array | Uint8ClampedArray, w: number, level: number, out: Uint8ClampedArray, phase = 0): number {
  let hits = 0;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const y = lumaPercent(px[i] as number, px[i + 1] as number, px[i + 2] as number);
    const x = p % w;
    const row = (p - x) / w;
    const over = y >= level;
    if (over) hits++;
    const stripe = over && (x + row + phase) % 8 < 4;
    out[i] = stripe ? 255 : 0;
    out[i + 1] = stripe ? 255 : 0;
    out[i + 2] = stripe ? 255 : 0;
    out[i + 3] = stripe ? 200 : 0;
  }
  return hits;
}

/** How much of the picture falls in each band (0–1), for the legend. */
export function bandShares(px: Uint8Array | Uint8ClampedArray): number[] {
  const counts = FALSE_COLOR.map(() => 0);
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const y = lumaPercent(px[i] as number, px[i + 1] as number, px[i + 2] as number);
    const k = FALSE_COLOR.findIndex((b) => y < b.upTo);
    counts[k < 0 ? counts.length - 1 : k] = (counts[k < 0 ? counts.length - 1 : k] as number) + 1;
  }
  return counts.map((c) => (n ? c / n : 0));
}
