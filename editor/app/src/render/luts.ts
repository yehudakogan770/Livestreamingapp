// 3D LUTs made here: a clip's grade saved as a .cube file (to use in a
// camera, a monitor or another editor), and technical LUTs that turn camera
// log footage into normal-looking Rec.709. The camera LUTs are worked out from
// the formulas the camera makers publish (log curve and color gamut), not
// copied from their files.
import { gradeAt, gradeOf, withGrade, type GradeNow } from '../model/grade';
import type { Clip } from '../model/types';
import { parseCube, type Cube } from './color';
import { gradePx, planGrade, type RGB } from './grade';

/** A color through a LUT (trilinear, as the GPU samples it). */
export function sampleCube(cube: Cube, [r, g, b]: RGB): RGB {
  const n = cube.size;
  const at = (v: number) => Math.max(0, Math.min(n - 1, v * (n - 1)));
  const x = at(r);
  const y = at(g);
  const z = at(b);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const z1 = Math.min(n - 1, z0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const d = cube.data;
  const v = (i: number, j: number, k: number, c: number) => d[((k * n + j) * n + i) * 3 + c] as number;
  const out: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = v(x0, y0, z0, c) * (1 - fx) + v(x1, y0, z0, c) * fx;
    const c10 = v(x0, y1, z0, c) * (1 - fx) + v(x1, y1, z0, c) * fx;
    const c01 = v(x0, y0, z1, c) * (1 - fx) + v(x1, y0, z1, c) * fx;
    const c11 = v(x0, y1, z1, c) * (1 - fx) + v(x1, y1, z1, c) * fx;
    out[c] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  }
  return out;
}

/** A LUT from a color function: `size` steps a side (17, 33 or 65), as .cube text. */
export function makeCube(title: string, size: number, f: (c: RGB) => RGB): string {
  const lines = [`TITLE "${title.replace(/"/g, "'")}"`, '# Made by Lumora Studio', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1', ''];
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const o = f([r * step, g * step, b * step]);
        lines.push(o.map((v) => Math.max(0, Math.min(1, v)).toFixed(6)).join(' '));
      }
  return `${lines.join('\n')}\n`;
}

/** The grade without its windows (a LUT can't know where in the picture a color is). */
function withoutWindows(g: GradeNow): GradeNow {
  return {
    steps: g.steps.map((s) =>
      s.kind === 'serial' ? { ...s, node: { ...s.node, window: null } } : { ...s, nodes: s.nodes.map((n) => ({ ...n, window: null })) },
    ),
  };
}

export interface GradeLut {
  text: string;
  /** What the LUT leaves out. */
  notes: string[];
}

/**
 * A clip's color (its grade nodes and LUTs, in order, as they are at `t`
 * frames into the clip) as a .cube file. Windows, vignettes and other
 * picture effects are left out: a LUT only changes colors.
 */
export function gradeToCube(clip: Clip, t: number, size: number, cubes: (path: string) => Cube | null, title = clip.name): GradeLut {
  const notes = new Set<string>();
  const steps: ((c: RGB) => RGB)[] = [];
  for (const e of withGrade(clip).effects) {
    if (!e.on) continue;
    if (e.type === 'grade') {
      const now = gradeAt(gradeOf(e), t);
      if (now.steps.some((s) => (s.kind === 'serial' ? [s.node] : s.nodes).some((n) => n.window)))
        notes.add('Windows (shapes) are left out: a LUT changes every pixel of a color the same way.');
      const plan = planGrade(withoutWindows(now));
      if (plan.steps.length) steps.push((c) => gradePx(plan, c));
    } else if (e.type === 'lut') {
      const path = typeof e.d?.path === 'string' ? e.d.path : '';
      const cube = path ? cubes(path) : null;
      if (!cube) {
        if (path) notes.add(`The LUT ${String(e.d?.name ?? path)} could not be read, so it is left out.`);
        continue;
      }
      const mixP = e.p.mix;
      const mix = (typeof mixP === 'number' ? mixP : 100) / 100;
      steps.push((c) => {
        const o = sampleCube(cube, c);
        return [c[0] + (o[0] - c[0]) * mix, c[1] + (o[1] - c[1]) * mix, c[2] + (o[2] - c[2]) * mix];
      });
    } else if (e.type === 'vignette') notes.add('The vignette is left out (it depends on where in the picture a pixel is).');
  }
  if (!steps.length) notes.add('This clip has no color changes yet: the LUT changes nothing.');
  const text = makeCube(title, size, (c) => steps.reduce((x, f) => f(x), c));
  return { text, notes: [...notes] };
}

// ---------------------------------------------------------------- camera log to Rec.709

type M3 = [number, number, number, number, number, number, number, number, number];
const mul = (m: M3, [r, g, b]: RGB): RGB => [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b];
const XYZ_TO_709: M3 = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252];
const REC2020_TO_XYZ: M3 = [0.636958, 0.144617, 0.168881, 0.2627, 0.677998, 0.059302, 0, 0.028073, 1.060985];

interface Camera {
  id: string;
  name: string;
  /** Log code value (0–1) to scene-linear light (0.18 is middle gray). */
  toLinear: (v: number) => number;
  /** The camera's gamut to CIE XYZ. */
  gamut: M3;
}

const CAMERAS: Camera[] = [
  {
    id: 'slog3',
    name: 'Sony S-Log3 / S-Gamut3.Cine',
    toLinear: (v) => {
      const x = v * 1023;
      return x >= 171.2102946929 ? 10 ** ((x - 420) / 261.5) * 0.19 - 0.01 : ((x - 95) * 0.01125) / (171.2102946929 - 95);
    },
    gamut: [0.5990839208, 0.2489255161, 0.1024464902, 0.2150758201, 0.8850685017, -0.1001443219, -0.0320658495, -0.0276583907, 1.148781991],
  },
  {
    id: 'logc3',
    name: 'ARRI LogC3 (EI 800) / ARRI Wide Gamut 3',
    toLinear: (v) => (v > 0.149658 ? (10 ** ((v - 0.385537) / 0.24719) - 0.052272) / 5.555556 : (v - 0.092809) / 5.367655),
    gamut: [0.638008, 0.214704, 0.097744, 0.291954, 0.823841, -0.115795, 0.002798, -0.067034, 1.153294],
  },
  {
    id: 'vlog',
    name: 'Panasonic V-Log / V-Gamut',
    toLinear: (v) => (v < 0.181 ? (v - 0.125) / 5.6 : 10 ** ((v - 0.598206) / 0.241514) - 0.00873),
    gamut: [0.679644, 0.152211, 0.1186, 0.260686, 0.774894, -0.03558, -0.00931, -0.004612, 1.10298],
  },
  {
    id: 'flog',
    name: 'Fujifilm F-Log / F-Gamut',
    toLinear: (v) => (v >= 0.100537775223865 ? (10 ** ((v - 0.790453) / 0.344676) - 0.009468) / 0.555556 : (v - 0.092864) / 8.735631),
    gamut: REC2020_TO_XYZ,
  },
  {
    id: 'applelog',
    name: 'Apple Log (iPhone 15 Pro and later)',
    toLinear: (v) => {
      const r0 = -0.05641088;
      const rt = 0.01;
      const c = 47.28711236;
      const pt = c * (rt - r0) ** 2;
      if (v >= pt) return 2 ** ((v - 0.69336945) / 0.08550479) - 0.00964052;
      return v > 0 ? Math.sqrt(v / c) + r0 : r0;
    },
    gamut: REC2020_TO_XYZ,
  },
];

/** Bright parts roll off gently instead of clipping (straight up to 0.6, then easing toward 1). */
function shoulder(x: number): number {
  const k = 0.6;
  if (x <= k) return Math.max(0, x);
  return k + (1 - k) * (1 - Math.exp(-(x - k) / (1 - k)));
}

/** Rec.709's transfer curve (scene light to video signal). */
const rec709 = (l: number): number => (l < 0.018 ? 4.5 * l : 1.099 * l ** 0.45 - 0.099);

/** A camera log color (0–1 code values) as Rec.709 video. */
export function logTo709(cameraId: string, c: RGB): RGB {
  const cam = CAMERAS.find((x) => x.id === cameraId);
  if (!cam) return c;
  const lin = mul(XYZ_TO_709, mul(cam.gamut, [cam.toLinear(c[0]), cam.toLinear(c[1]), cam.toLinear(c[2])]));
  return [rec709(shoulder(lin[0])), rec709(shoulder(lin[1])), rec709(shoulder(lin[2]))];
}

/** The built-in camera LUTs (path "builtin:<id>" in a LUT effect). */
export const BUILTIN_LUTS = CAMERAS.map((c) => ({ id: c.id, path: `builtin:${c.id}`, name: `${c.name} to Rec.709` }));

const made = new Map<string, Cube>();
/** A built-in LUT by its path ("builtin:slog3"), made the first time it is asked for. */
export function builtinCube(path: string): Cube | null {
  if (!path.startsWith('builtin:')) return null;
  const have = made.get(path);
  if (have) return have;
  const id = path.slice(8);
  const info = BUILTIN_LUTS.find((x) => x.id === id);
  if (!info) return null;
  const cube = parseCube(makeCube(info.name, 33, (c) => logTo709(id, c)));
  made.set(path, cube);
  return cube;
}

/** The sizes people use: 17 (cameras and monitors), 33 (most software) and 65 (finishing). */
export const LUT_SIZES = [17, 33, 65] as const;
