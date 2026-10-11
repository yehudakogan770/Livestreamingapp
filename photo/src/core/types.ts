// Lumora Photo's document model. A document is a stack of layers over a
// canvas; pixels live in sparse tiled rasters (see raster.ts) that the GPU
// compositor uploads tile by tile. Layer records are treated as immutable:
// every edit makes a new record (so a history step can keep the old tree by
// reference), while raster tiles are replaced, never changed in place, once
// an edit is committed.

import type { Raster } from './raster';
import type { ColorProfile } from './color';
import type { AdjustmentType, AdjustmentParams } from './adjust';
import type { BlendMode } from './blend';
import type { LayerStyles } from './styles';
import type { TextModel } from './text';
import type { VectorPath } from './path';
import type { SmartFilter } from './smartFilters';
import type { Gradient } from './gradient';

export type Depth = 8 | 16 | 32;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An RGBA color, each channel 0..1 (straight alpha), in the document's space. */
export type RGBA = [number, number, number, number];

/** A layer mask: a 1-channel raster (white shows) plus its settings. */
export interface LayerMask {
  raster: Raster;
  /** The value outside the raster's tiles (0 hides everything not painted, 1 shows). */
  background: number;
  enabled: boolean;
  linked: boolean;
  /** 0..1: how strongly the mask hides. */
  density: number;
  /** Pixels of soft edge applied when drawing. */
  feather: number;
}

export interface VectorMask {
  path: VectorPath;
  enabled: boolean;
  feather: number;
}

export interface LayerLocks {
  transparency?: boolean;
  pixels?: boolean;
  position?: boolean;
  all?: boolean;
}

export type LayerColorTag = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'gray';

export interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  /** 0..1: the layer's content without its effects. */
  fill: number;
  blend: BlendMode;
  /** Clipped to the layer below (a clipping mask). */
  clip: boolean;
  locks: LayerLocks;
  mask?: LayerMask;
  vmask?: VectorMask;
  styles?: LayerStyles;
  tag?: LayerColorTag;
}

export interface PixelLayer extends LayerBase {
  kind: 'pixel';
  raster: Raster;
}

export interface GroupLayer extends LayerBase {
  kind: 'group';
  /** Bottom to top. */
  children: Layer[];
  open: boolean;
  /** Pass through: the group's layers blend with what is below the group. */
  passThrough: boolean;
}

export interface AdjustmentLayer extends LayerBase {
  kind: 'adjust';
  adjust: AdjustmentType;
  params: AdjustmentParams;
}

export type FillContent =
  | { type: 'solid'; color: RGBA }
  /** A gradient: by angle and scale about the canvas center (plus offset), or between two points (`p0` → `p1`, the Gradient tool's handles). */
  | { type: 'gradient'; gradient: Gradient; angle: number; scale: number; style: GradientStyle; reverse: boolean; ox: number; oy: number; p0?: [number, number]; p1?: [number, number]; dither?: boolean }
  | { type: 'pattern'; pattern: string; scale: number; ox: number; oy: number };

export type GradientStyle = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';

export interface FillLayer extends LayerBase {
  kind: 'fill';
  content: FillContent;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: TextModel;
  /** Drawn from `text` (kept until the text changes). */
  raster: Raster;
}

export interface ShapeStroke {
  color: RGBA;
  width: number;
  align: 'inside' | 'center' | 'outside';
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  dash: number[];
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  path: VectorPath;
  fillColor: RGBA | null;
  fillGradient?: { gradient: Gradient; angle: number; style: GradientStyle } | null;
  stroke: ShapeStroke | null;
  raster: Raster;
}

/** A smart object's own content, kept whole: transforms and filters are redone from it. */
export interface SmartSource {
  kind: 'raster' | 'svg' | 'document';
  width: number;
  height: number;
  /** The pixels (raster sources and drawn SVGs). */
  raster: Raster;
  svg?: string;
  /** A linked file's name (shown in Properties). */
  name: string;
}

export interface SmartLayer extends LayerBase {
  kind: 'smart';
  source: SmartSource;
  /** Source pixels → document: a projective 3×3 matrix (row-major). */
  transform: number[];
  filters: SmartFilter[];
  filtersVisible: boolean;
  /** The filter mask (white: filters show). */
  filterMask?: Raster;
  /** The result (source, filtered, transformed). */
  raster: Raster;
}

export type Layer = PixelLayer | GroupLayer | AdjustmentLayer | FillLayer | TextLayer | ShapeLayer | SmartLayer;
export type LayerKind = Layer['kind'];

/** A saved selection or extra (alpha) channel. */
export interface AlphaChannel {
  id: string;
  name: string;
  raster: Raster;
  visible: boolean;
  color: RGBA;
}

export interface Guide {
  id: string;
  axis: 'x' | 'y';
  at: number;
}

export interface SavedPath {
  id: string;
  name: string;
  path: VectorPath;
}

export interface LayerCompState {
  visible: boolean;
  x?: number;
  y?: number;
  styles?: LayerStyles;
}

export interface LayerComp {
  id: string;
  name: string;
  comment: string;
  layers: Record<string, LayerCompState>;
}

export interface Artboard {
  id: string;
  name: string;
  rect: Rect;
  background: RGBA | null;
}

export interface Slice {
  id: string;
  name: string;
  rect: Rect;
}

export interface Selection {
  /** 1 channel, document size, 8-bit coverage (masks, selections and channels are always 8-bit). */
  mask: Raster;
  /** Cached bounds of the non-zero part. */
  bounds: Rect | null;
}

export interface Doc {
  id: string;
  name: string;
  width: number;
  height: number;
  depth: Depth;
  profile: ColorProfile;
  /** Pixels per inch. */
  resolution: number;
  /** Bottom to top. */
  layers: Layer[];
  selection: Selection | null;
  channels: AlphaChannel[];
  paths: SavedPath[];
  guides: Guide[];
  comps: LayerComp[];
  artboards: Artboard[];
  slices: Slice[];
  /** The file it came from (desktop path or a browser file name). */
  file?: string | null;
  /** The format it was opened from (for Save). */
  format?: string;
  meta?: Record<string, string>;
}

export const DEPTH_MAX: Record<Depth, number> = { 8: 255, 16: 65535, 32: 1 };
