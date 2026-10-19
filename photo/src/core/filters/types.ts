// What a filter is: its settings (which build its dialog), how far it looks
// around each pixel (so big pictures can be split into bands across
// workers), and the function itself (float RGBA in, float RGBA out).

import type { Img } from '../img';

export type ParamDef =
  | { key: string; label: string; type: 'number'; min: number; max: number; step?: number; def: number; unit?: string; log?: boolean }
  | { key: string; label: string; type: 'select'; options: [string, string][]; def: string }
  | { key: string; label: string; type: 'bool'; def: boolean }
  | { key: string; label: string; type: 'color'; def: [number, number, number] }
  | { key: string; label: string; type: 'point'; def: [number, number] }
  | { key: string; label: string; type: 'angle'; def: number }
  | { key: string; label: string; type: 'seed'; def: number };

export type Params = Record<string, unknown>;

export interface FilterContext {
  /** The whole picture's size (a band knows where it sits). */
  width: number;
  height: number;
  /** Where this image's top-left is in the whole picture. */
  ox?: number;
  oy?: number;
  /** Extra inputs some filters need (Displace's map, Lighting's texture). */
  extra?: Record<string, Img>;
  /** Called with 0..1 as long filters work. */
  progress?: (p: number) => void;
}

export interface FilterDef {
  id: string;
  name: string;
  /** Filter menu submenu (empty: top level). */
  menu: string;
  params: ParamDef[];
  run: (img: Img, p: Params, ctx: FilterContext) => Img;
  /** Pixels around each pixel it reads (bands overlap by this). Infinity: needs the whole picture. */
  reach: (p: Params, ctx: { width: number; height: number }) => number;
  /** Has a dialog (false: runs at once, like Blur More). */
  dialog?: boolean;
  /** Can be a smart filter. */
  smart?: boolean;
  /** Hidden from the menu (internal, or not good enough yet). */
  hidden?: boolean;
  /** The dialog shows the result on the canvas (big, slow previews off by default). */
  canvasPreview?: boolean;
}

export function defaults(def: FilterDef): Params {
  const p: Params = {};
  for (const d of def.params) p[d.key] = Array.isArray(d.def) ? [...d.def] : d.def;
  return p;
}

export const num = (p: Params, k: string, d = 0): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
export const str = (p: Params, k: string, d = ''): string => (typeof p[k] === 'string' ? (p[k] as string) : d);
export const bool = (p: Params, k: string, d = false): boolean => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);
export const vec = (p: Params, k: string, d: [number, number] = [0.5, 0.5]): [number, number] => (Array.isArray(p[k]) ? (p[k] as [number, number]) : d);
export const col = (p: Params, k: string, d: [number, number, number] = [1, 1, 1]): [number, number, number] =>
  Array.isArray(p[k]) ? (p[k] as [number, number, number]) : d;
