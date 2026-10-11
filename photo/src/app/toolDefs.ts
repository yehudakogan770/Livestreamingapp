// The tools: names, Photoshop's default shortcuts, the toolbar's groups, and
// each tool's options (what the options bar shows).

import type { BlendMode, PaintMode } from '../core/blend';
import type { GradientStyle } from '../core/types';
import type { SelectOp } from '../core/selection';
import { defaultTip, type BrushTip } from '../core/brush';

export { defaultTip, type BrushTip };

export type ToolId =
  | 'move'
  | 'artboard'
  | 'marqueeRect'
  | 'marqueeEllipse'
  | 'marqueeRow'
  | 'marqueeColumn'
  | 'lasso'
  | 'polyLasso'
  | 'magneticLasso'
  | 'objectSelect'
  | 'quickSelect'
  | 'magicWand'
  | 'crop'
  | 'perspectiveCrop'
  | 'slice'
  | 'eyedropper'
  | 'colorSampler'
  | 'ruler'
  | 'spotHeal'
  | 'heal'
  | 'patch'
  | 'removeTool'
  | 'redEye'
  | 'brush'
  | 'pencil'
  | 'colorReplace'
  | 'mixer'
  | 'clone'
  | 'patternStamp'
  | 'historyBrush'
  | 'eraser'
  | 'bgEraser'
  | 'magicEraser'
  | 'gradient'
  | 'bucket'
  | 'blur'
  | 'sharpen'
  | 'smudge'
  | 'dodge'
  | 'burn'
  | 'sponge'
  | 'pen'
  | 'freeformPen'
  | 'curvaturePen'
  | 'addAnchor'
  | 'deleteAnchor'
  | 'convertPoint'
  | 'type'
  | 'typeVertical'
  | 'pathSelect'
  | 'directSelect'
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'polygon'
  | 'line'
  | 'customShape'
  | 'hand'
  | 'rotateView'
  | 'zoom';

export interface ToolDef {
  id: ToolId;
  name: string;
  key: string;
  /** Hidden until it works well. */
  hidden?: boolean;
}

/** The toolbar, top to bottom; each group shares a button (and a shortcut, Shift+key cycles). */
export const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: 'move', name: 'Move Tool', key: 'V' },
    { id: 'artboard', name: 'Artboard Tool', key: 'V' },
  ],
  [
    { id: 'marqueeRect', name: 'Rectangular Marquee Tool', key: 'M' },
    { id: 'marqueeEllipse', name: 'Elliptical Marquee Tool', key: 'M' },
    { id: 'marqueeRow', name: 'Single Row Marquee Tool', key: '' },
    { id: 'marqueeColumn', name: 'Single Column Marquee Tool', key: '' },
  ],
  [
    { id: 'lasso', name: 'Lasso Tool', key: 'L' },
    { id: 'polyLasso', name: 'Polygonal Lasso Tool', key: 'L' },
    { id: 'magneticLasso', name: 'Magnetic Lasso Tool', key: 'L' },
  ],
  [
    { id: 'objectSelect', name: 'Object Selection Tool', key: 'W' },
    { id: 'quickSelect', name: 'Quick Selection Tool', key: 'W' },
    { id: 'magicWand', name: 'Magic Wand Tool', key: 'W' },
  ],
  [
    { id: 'crop', name: 'Crop Tool', key: 'C' },
    { id: 'perspectiveCrop', name: 'Perspective Crop Tool', key: 'C' },
    { id: 'slice', name: 'Slice Tool', key: 'C' },
  ],
  [
    { id: 'eyedropper', name: 'Eyedropper Tool', key: 'I' },
    { id: 'colorSampler', name: 'Color Sampler Tool', key: 'I' },
    { id: 'ruler', name: 'Ruler Tool', key: 'I' },
  ],
  [
    { id: 'spotHeal', name: 'Spot Healing Brush Tool', key: 'J' },
    { id: 'removeTool', name: 'Remove Tool', key: 'J' },
    { id: 'heal', name: 'Healing Brush Tool', key: 'J' },
    { id: 'patch', name: 'Patch Tool', key: 'J' },
    { id: 'redEye', name: 'Red Eye Tool', key: 'J' },
  ],
  [
    { id: 'brush', name: 'Brush Tool', key: 'B' },
    { id: 'pencil', name: 'Pencil Tool', key: 'B' },
    { id: 'colorReplace', name: 'Color Replacement Tool', key: 'B' },
    { id: 'mixer', name: 'Mixer Brush Tool', key: 'B' },
  ],
  [
    { id: 'clone', name: 'Clone Stamp Tool', key: 'S' },
    { id: 'patternStamp', name: 'Pattern Stamp Tool', key: 'S' },
  ],
  [{ id: 'historyBrush', name: 'History Brush Tool', key: 'Y' }],
  [
    { id: 'eraser', name: 'Eraser Tool', key: 'E' },
    { id: 'bgEraser', name: 'Background Eraser Tool', key: 'E' },
    { id: 'magicEraser', name: 'Magic Eraser Tool', key: 'E' },
  ],
  [
    { id: 'gradient', name: 'Gradient Tool', key: 'G' },
    { id: 'bucket', name: 'Paint Bucket Tool', key: 'G' },
  ],
  [
    { id: 'blur', name: 'Blur Tool', key: '' },
    { id: 'sharpen', name: 'Sharpen Tool', key: '' },
    { id: 'smudge', name: 'Smudge Tool', key: '' },
  ],
  [
    { id: 'dodge', name: 'Dodge Tool', key: 'O' },
    { id: 'burn', name: 'Burn Tool', key: 'O' },
    { id: 'sponge', name: 'Sponge Tool', key: 'O' },
  ],
  [
    { id: 'pen', name: 'Pen Tool', key: 'P' },
    { id: 'freeformPen', name: 'Freeform Pen Tool', key: 'P' },
    { id: 'curvaturePen', name: 'Curvature Pen Tool', key: 'P' },
    { id: 'addAnchor', name: 'Add Anchor Point Tool', key: '' },
    { id: 'deleteAnchor', name: 'Delete Anchor Point Tool', key: '' },
    { id: 'convertPoint', name: 'Convert Point Tool', key: '' },
  ],
  [
    { id: 'type', name: 'Horizontal Type Tool', key: 'T' },
    { id: 'typeVertical', name: 'Vertical Type Tool', key: 'T', hidden: true },
  ],
  [
    { id: 'pathSelect', name: 'Path Selection Tool', key: 'A' },
    { id: 'directSelect', name: 'Direct Selection Tool', key: 'A' },
  ],
  [
    { id: 'rect', name: 'Rectangle Tool', key: 'U' },
    { id: 'ellipse', name: 'Ellipse Tool', key: 'U' },
    { id: 'triangle', name: 'Triangle Tool', key: 'U' },
    { id: 'polygon', name: 'Polygon Tool', key: 'U' },
    { id: 'line', name: 'Line Tool', key: 'U' },
    { id: 'customShape', name: 'Custom Shape Tool', key: 'U' },
  ],
  [
    { id: 'hand', name: 'Hand Tool', key: 'H' },
    { id: 'rotateView', name: 'Rotate View Tool', key: 'R' },
  ],
  [{ id: 'zoom', name: 'Zoom Tool', key: 'Z' }],
];

export const ALL_TOOLS: ToolDef[] = TOOL_GROUPS.flat();
export const toolDef = (id: ToolId): ToolDef => ALL_TOOLS.find((t) => t.id === id)!;
export const groupOf = (id: ToolId): ToolDef[] => TOOL_GROUPS.find((g) => g.some((t) => t.id === id))!;

export interface ToolOptions {
  selection: { op: SelectOp; feather: number; antialias: boolean; style: 'normal' | 'fixedRatio' | 'fixedSize'; w: number; h: number };
  wand: { tolerance: number; contiguous: boolean; antialias: boolean; allLayers: boolean };
  quick: { size: number; allLayers: boolean; enhance: boolean };
  magnetic: { width: number; contrast: number; frequency: number };
  brush: { tip: BrushTip; mode: PaintMode; opacity: number; flow: number; airbrush: boolean };
  pencil: { tip: BrushTip; mode: PaintMode; opacity: number; autoErase: boolean };
  eraser: { tip: BrushTip; opacity: number; flow: number; mode: 'brush' | 'pencil' | 'block'; history: boolean };
  bgEraser: { tip: BrushTip; tolerance: number; protectFg: boolean; limits: 'contiguous' | 'discontiguous' };
  magicEraser: { tolerance: number; contiguous: boolean; antialias: boolean; opacity: number; allLayers: boolean };
  mixer: { tip: BrushTip; wet: number; load: number; mix: number; flow: number; clean: boolean; allLayers: boolean };
  colorReplace: { tip: BrushTip; mode: 'hue' | 'saturation' | 'color' | 'luminosity'; tolerance: number };
  clone: { tip: BrushTip; opacity: number; flow: number; aligned: boolean; sample: 'current' | 'below' | 'all'; mode: BlendMode };
  pattern: { tip: BrushTip; opacity: number; flow: number; pattern: string; aligned: boolean };
  history: { tip: BrushTip; opacity: number; flow: number; mode: BlendMode };
  heal: { tip: BrushTip; mode: 'normal' | 'replace' | 'multiply' | 'screen' | 'darken' | 'lighten'; source: 'sampled' | 'pattern'; aligned: boolean; sample: 'current' | 'all' };
  spot: { tip: BrushTip; type: 'contentAware' | 'proximity' | 'texture'; allLayers: boolean };
  remove: { tip: BrushTip; allLayers: boolean };
  patch: { mode: 'normal' | 'contentAware'; source: boolean; structure: number };
  redEye: { pupil: number; darken: number };
  focus: { tip: BrushTip; strength: number; mode: BlendMode; allLayers: boolean; protectDetail: boolean; fingerPainting: boolean };
  tone: { tip: BrushTip; range: 'shadows' | 'midtones' | 'highlights'; exposure: number; protectTones: boolean; sponge: 'saturate' | 'desaturate'; flow: number; vibrance: boolean };
  gradient: { style: GradientStyle; mode: BlendMode; opacity: number; reverse: boolean; dither: boolean; transparency: boolean; preset: number; asLayer: boolean };
  bucket: { source: 'fg' | 'pattern'; pattern: string; mode: BlendMode; opacity: number; tolerance: number; antialias: boolean; contiguous: boolean; allLayers: boolean };
  crop: { ratio: 'free' | 'original' | '1:1' | '4:5' | '5:7' | '2:3' | '16:9' | '9:16' | 'custom'; w: number; h: number; deleteCropped: boolean; contentAware: boolean; overlay: 'thirds' | 'grid' | 'golden' | 'diagonal' | 'none'; straighten: boolean };
  eyedropper: { sample: 1 | 3 | 5 | 11 | 31; from: 'all' | 'current' };
  type: { family: string; weight: number; italic: boolean; size: number; align: 'left' | 'center' | 'right' | 'justify'; antialias: 'none' | 'sharp' | 'smooth' };
  shape: { mode: 'shape' | 'path' | 'pixels'; fill: [number, number, number] | null; stroke: [number, number, number] | null; strokeWidth: number; radius: number; sides: number; star: number; lineWeight: number; custom: string };
  pen: { mode: 'shape' | 'path'; autoAdd: boolean; rubberBand: boolean };
  move: { autoSelect: boolean; autoSelectGroups: boolean; showTransform: boolean };
  zoom: { scrubby: boolean; resizeWindows: boolean };
}

export function defaultOptions(): ToolOptions {
  return {
    selection: { op: 'replace', feather: 0, antialias: true, style: 'normal', w: 1, h: 1 },
    wand: { tolerance: 32, contiguous: true, antialias: true, allLayers: false },
    quick: { size: 30, allLayers: false, enhance: true },
    magnetic: { width: 10, contrast: 0.1, frequency: 57 },
    brush: { tip: defaultTip(30, 0), mode: 'normal', opacity: 1, flow: 1, airbrush: false },
    pencil: { tip: { ...defaultTip(3, 1), smoothing: 0 }, mode: 'normal', opacity: 1, autoErase: false },
    eraser: { tip: defaultTip(40, 0), opacity: 1, flow: 1, mode: 'brush', history: false },
    bgEraser: { tip: defaultTip(60, 1), tolerance: 50, protectFg: false, limits: 'contiguous' },
    magicEraser: { tolerance: 32, contiguous: true, antialias: true, opacity: 1, allLayers: false },
    mixer: { tip: defaultTip(40, 0.4), wet: 0.5, load: 0.5, mix: 0.5, flow: 1, clean: true, allLayers: false },
    colorReplace: { tip: defaultTip(30, 1), mode: 'color', tolerance: 30 },
    clone: { tip: defaultTip(60, 0.5), opacity: 1, flow: 1, aligned: true, sample: 'current', mode: 'normal' },
    pattern: { tip: defaultTip(60, 0.5), opacity: 1, flow: 1, pattern: 'paper', aligned: true },
    history: { tip: defaultTip(60, 0), opacity: 1, flow: 1, mode: 'normal' },
    heal: { tip: defaultTip(40, 0.6), mode: 'normal', source: 'sampled', aligned: true, sample: 'current' },
    spot: { tip: defaultTip(40, 0.6), type: 'contentAware', allLayers: false },
    remove: { tip: defaultTip(60, 0.8), allLayers: false },
    patch: { mode: 'contentAware', source: true, structure: 4 },
    redEye: { pupil: 0.5, darken: 0.5 },
    focus: { tip: defaultTip(40, 0), strength: 0.5, mode: 'normal', allLayers: false, protectDetail: true, fingerPainting: false },
    tone: { tip: defaultTip(60, 0), range: 'midtones', exposure: 0.5, protectTones: true, sponge: 'desaturate', flow: 0.5, vibrance: true },
    gradient: { style: 'linear', mode: 'normal', opacity: 1, reverse: false, dither: true, transparency: true, preset: 0, asLayer: false },
    bucket: { source: 'fg', pattern: 'paper', mode: 'normal', opacity: 1, tolerance: 32, antialias: true, contiguous: true, allLayers: false },
    crop: { ratio: 'free', w: 0, h: 0, deleteCropped: true, contentAware: false, overlay: 'thirds', straighten: false },
    eyedropper: { sample: 1, from: 'all' },
    type: { family: 'Inter Variable', weight: 400, italic: false, size: 72, align: 'left', antialias: 'smooth' },
    shape: { mode: 'shape', fill: [0.2, 0.45, 0.85], stroke: null, strokeWidth: 3, radius: 0, sides: 5, star: 0, lineWeight: 4, custom: 'heart' },
    pen: { mode: 'path', autoAdd: true, rubberBand: false },
    move: { autoSelect: false, autoSelectGroups: false, showTransform: false },
    zoom: { scrubby: true, resizeWindows: false },
  };
}
