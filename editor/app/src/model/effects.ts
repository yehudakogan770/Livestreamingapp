import { uid, type Effect } from './types';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  def: number;
  step: number;
  unit?: string;
  /** Shown as a switch (0 or 1). */
  toggle?: boolean;
  /** Shown as a choice. */
  options?: string[];
}

export interface EffectDef {
  type: string;
  name: string;
  kind: 'video' | 'audio';
  group: string;
  params: ParamDef[];
  /** Settings that aren't numbers, with their starting values. */
  data?: Record<string, unknown>;
  /** Shown while editing too (some sound effects are only made on export). */
  previewNote?: string;
  /** Not in the effects list (made by another part of the program). */
  hidden?: boolean;
}

const P = (key: string, label: string, min: number, max: number, def: number, step = 1, unit?: string): ParamDef => ({
  key,
  label,
  min,
  max,
  def,
  step,
  ...(unit ? { unit } : {}),
});

export const EFFECTS: EffectDef[] = [
  // ---- Color ----
  {
    type: 'basic',
    name: 'Basic correction',
    kind: 'video',
    group: 'Color',
    params: [
      P('exposure', 'Exposure', -4, 4, 0, 0.05),
      P('contrast', 'Contrast', -100, 100, 0),
      P('highlights', 'Highlights', -100, 100, 0),
      P('shadows', 'Shadows', -100, 100, 0),
      P('whites', 'Whites', -100, 100, 0),
      P('blacks', 'Blacks', -100, 100, 0),
      P('temperature', 'Temperature', -100, 100, 0),
      P('tint', 'Tint', -100, 100, 0),
      P('saturation', 'Saturation', 0, 200, 100, 1, '%'),
      P('vibrance', 'Vibrance', -100, 100, 0),
    ],
  },
  {
    type: 'wheels',
    name: 'Color wheels',
    kind: 'video',
    group: 'Color',
    params: [
      P('liftX', 'Shadows color ↔', -1, 1, 0, 0.01),
      P('liftY', 'Shadows color ↕', -1, 1, 0, 0.01),
      P('lift', 'Shadows level', -100, 100, 0),
      P('gammaX', 'Midtones color ↔', -1, 1, 0, 0.01),
      P('gammaY', 'Midtones color ↕', -1, 1, 0, 0.01),
      P('gamma', 'Midtones level', -100, 100, 0),
      P('gainX', 'Highlights color ↔', -1, 1, 0, 0.01),
      P('gainY', 'Highlights color ↕', -1, 1, 0, 0.01),
      P('gain', 'Highlights level', -100, 100, 0),
    ],
  },
  {
    type: 'curves',
    name: 'Curves',
    kind: 'video',
    group: 'Color',
    params: [P('mix', 'Amount', 0, 100, 100, 1, '%')],
    data: {
      master: [
        [0, 0],
        [1, 1],
      ],
      r: [
        [0, 0],
        [1, 1],
      ],
      g: [
        [0, 0],
        [1, 1],
      ],
      b: [
        [0, 0],
        [1, 1],
      ],
    },
  },
  { type: 'lut', name: 'LUT (look)', kind: 'video', group: 'Color', params: [P('mix', 'Amount', 0, 100, 100, 1, '%')], data: { path: '', name: '' } },
  {
    type: 'hsl',
    name: 'Change one color',
    kind: 'video',
    group: 'Color',
    params: [
      P('hue', 'Which color (hue)', 0, 360, 30, 1, '°'),
      P('range', 'How wide', 5, 180, 30, 1, '°'),
      P('shift', 'Hue shift', -180, 180, 0, 1, '°'),
      P('sat', 'Saturation', -100, 100, 0),
      P('light', 'Lightness', -100, 100, 0),
    ],
  },
  {
    type: 'vignette',
    name: 'Vignette',
    kind: 'video',
    group: 'Color',
    params: [P('amount', 'Amount', -100, 100, -40), P('size', 'Size', 0, 100, 60), P('feather', 'Feather', 0, 100, 50)],
  },
  // The Color page's node grade (its settings are in `d`, see model/grade.ts).
  { type: 'grade', name: 'Color grade (nodes)', kind: 'video', group: 'Color', params: [], hidden: true },
  { type: 'bw', name: 'Black & white', kind: 'video', group: 'Color', params: [P('mix', 'Amount', 0, 100, 100, 1, '%')] },
  { type: 'invert', name: 'Invert', kind: 'video', group: 'Color', params: [P('mix', 'Amount', 0, 100, 100, 1, '%')] },
  // ---- Blur & sharpen ----
  { type: 'blur', name: 'Gaussian blur', kind: 'video', group: 'Blur & sharpen', params: [P('radius', 'Blurriness', 0, 200, 20, 0.5)] },
  { type: 'sharpen', name: 'Sharpen', kind: 'video', group: 'Blur & sharpen', params: [P('amount', 'Amount', 0, 300, 60)] },
  // ---- Keying ----
  {
    type: 'chromakey',
    name: 'Green screen key',
    kind: 'video',
    group: 'Keying',
    params: [P('tolerance', 'Tolerance', 0, 100, 30), P('softness', 'Softness', 0, 100, 15), P('spill', 'Spill removal', 0, 100, 50)],
    data: { color: '#00b140' },
  },
  {
    type: 'lumakey',
    name: 'Luma key',
    kind: 'video',
    group: 'Keying',
    params: [P('threshold', 'Threshold', 0, 100, 10), P('softness', 'Softness', 0, 100, 10), { ...P('invert', 'Key out bright', 0, 1, 0), toggle: true }],
  },
  {
    type: 'mask',
    name: 'Shape mask',
    kind: 'video',
    group: 'Keying',
    params: [
      { ...P('shape', 'Shape', 0, 1, 0), options: ['Ellipse', 'Rectangle'] },
      P('cx', 'Center ↔', -100, 100, 0, 0.5, '%'),
      P('cy', 'Center ↕', -100, 100, 0, 0.5, '%'),
      P('w', 'Width', 1, 200, 40, 0.5, '%'),
      P('h', 'Height', 1, 200, 50, 0.5, '%'),
      P('feather', 'Feather', 0, 100, 10),
      { ...P('invert', 'Invert', 0, 1, 0), toggle: true },
    ],
  },
  // ---- Stylize ----
  { type: 'mosaic', name: 'Mosaic (pixelate)', kind: 'video', group: 'Stylize', params: [P('size', 'Block size', 2, 200, 24)] },
  { type: 'grain', name: 'Film grain', kind: 'video', group: 'Stylize', params: [P('amount', 'Amount', 0, 100, 20), P('size', 'Size', 1, 4, 1.5, 0.1)] },
  {
    type: 'glow',
    name: 'Glow',
    kind: 'video',
    group: 'Stylize',
    params: [P('threshold', 'Threshold', 0, 100, 65), P('radius', 'Radius', 1, 100, 25), P('amount', 'Amount', 0, 200, 80)],
  },
  {
    type: 'flip',
    name: 'Flip',
    kind: 'video',
    group: 'Transform',
    params: [
      { ...P('h', 'Left ↔ right', 0, 1, 1), toggle: true },
      { ...P('v', 'Upside down', 0, 1, 0), toggle: true },
    ],
  },
  {
    type: 'shadow',
    name: 'Drop shadow',
    kind: 'video',
    group: 'Stylize',
    params: [
      P('distance', 'Distance', 0, 100, 12),
      P('angle', 'Direction', 0, 360, 135, 1, '°'),
      P('softness', 'Softness', 0, 100, 20),
      P('opacity', 'Opacity', 0, 100, 60, 1, '%'),
    ],
  },
  // ---- 3D & VFX ----
  {
    type: 'cornerpin',
    name: 'Corner pin',
    kind: 'video',
    group: '3D & VFX',
    params: [
      P('tlx', 'Top left ↔', -2000, 2000, 0, 1, 'px'),
      P('tly', 'Top left ↕', -2000, 2000, 0, 1, 'px'),
      P('trx', 'Top right ↔', -2000, 2000, 0, 1, 'px'),
      P('try', 'Top right ↕', -2000, 2000, 0, 1, 'px'),
      P('blx', 'Bottom left ↔', -2000, 2000, 0, 1, 'px'),
      P('bly', 'Bottom left ↕', -2000, 2000, 0, 1, 'px'),
      P('brx', 'Bottom right ↔', -2000, 2000, 0, 1, 'px'),
      P('bry', 'Bottom right ↕', -2000, 2000, 0, 1, 'px'),
    ],
  },
  { type: 'chromatic', name: 'Color fringe (chromatic)', kind: 'video', group: '3D & VFX', params: [P('amount', 'Amount', 0, 100, 30)] },
  { type: 'glitch', name: 'Glitch', kind: 'video', group: '3D & VFX', params: [P('amount', 'Amount', 0, 100, 40), P('speed', 'Speed', 0, 100, 50)] },
  { type: 'vhs', name: 'Old tape (VHS)', kind: 'video', group: '3D & VFX', params: [P('amount', 'Amount', 0, 100, 50)] },
  {
    type: 'zoomblur',
    name: 'Zoom blur',
    kind: 'video',
    group: 'Blur & sharpen',
    params: [P('amount', 'Amount', 0, 100, 30), P('cx', 'Center ↔', -100, 100, 0, 0.5, '%'), P('cy', 'Center ↕', -100, 100, 0, 0.5, '%')],
  },
  {
    type: 'dirblur',
    name: 'Motion blur (direction)',
    kind: 'video',
    group: 'Blur & sharpen',
    params: [P('angle', 'Direction', 0, 360, 0, 1, '°'), P('length', 'Length', 0, 200, 30)],
  },
  {
    type: 'displace',
    name: 'Turbulence',
    kind: 'video',
    group: '3D & VFX',
    params: [P('amount', 'Amount', 0, 200, 30), P('size', 'Size', 1, 200, 50), P('speed', 'Speed', 0, 200, 50)],
  },
  {
    type: 'wave',
    name: 'Wave',
    kind: 'video',
    group: '3D & VFX',
    params: [P('amount', 'Amount', 0, 200, 20), P('size', 'Waves', 1, 200, 30), P('speed', 'Speed', 0, 200, 50)],
  },
  { type: 'posterize', name: 'Posterize', kind: 'video', group: 'Stylize', params: [P('levels', 'Levels', 2, 32, 6)] },
  {
    type: 'edges',
    name: 'Find edges',
    kind: 'video',
    group: 'Stylize',
    params: [P('amount', 'Amount', 0, 100, 100), { ...P('invert', 'Dark lines', 0, 1, 0), toggle: true }],
  },
  // ---- Audio ----
  {
    type: 'eq',
    name: 'Equalizer',
    kind: 'audio',
    group: 'Sound',
    params: [
      P('low', 'Low (100 Hz)', -18, 18, 0, 0.5, 'dB'),
      P('lowMid', 'Low-mid (400 Hz)', -18, 18, 0, 0.5, 'dB'),
      P('highMid', 'High-mid (2.5 kHz)', -18, 18, 0, 0.5, 'dB'),
      P('high', 'High (8 kHz)', -18, 18, 0, 0.5, 'dB'),
      P('lowCut', 'Low cut', 0, 300, 0, 5, 'Hz'),
    ],
  },
  {
    type: 'compressor',
    name: 'Compressor',
    kind: 'audio',
    group: 'Sound',
    params: [
      P('threshold', 'Threshold', -60, 0, -20, 0.5, 'dB'),
      P('ratio', 'Ratio', 1, 20, 4, 0.1),
      P('attack', 'Attack', 1, 200, 10, 1, 'ms'),
      P('release', 'Release', 10, 1000, 150, 5, 'ms'),
      P('makeup', 'Make-up gain', 0, 24, 3, 0.5, 'dB'),
    ],
  },
  {
    type: 'denoise',
    name: 'Noise reduction',
    kind: 'audio',
    group: 'Sound',
    params: [P('amount', 'Amount', 0, 100, 50)],
    previewNote: 'You hear it in the exported film.',
  },
  {
    type: 'deess',
    name: 'De-esser',
    kind: 'audio',
    group: 'Sound',
    params: [P('amount', 'Amount', 0, 100, 50)],
    previewNote: 'You hear it in the exported film.',
  },
  { type: 'limiter', name: 'Limiter', kind: 'audio', group: 'Sound', params: [P('ceiling', 'Ceiling', -12, 0, -1, 0.1, 'dB')] },
  { type: 'voice', name: 'Voice clarity', kind: 'audio', group: 'Sound', params: [P('amount', 'Amount', 0, 100, 50)] },
];

export const effectDef = (type: string): EffectDef | undefined => EFFECTS.find((e) => e.type === type);

export function newEffect(type: string): Effect {
  const def = effectDef(type);
  const p: Record<string, number> = {};
  for (const x of def?.params ?? []) p[x.key] = x.def;
  return { id: uid('e'), type, on: true, p, ...(def?.data ? { d: structuredClone(def.data) } : {}) };
}

export interface TransitionDef {
  type: string;
  name: string;
  kind: 'video' | 'audio';
}
export const TRANSITIONS: TransitionDef[] = [
  { type: 'dissolve', name: 'Cross dissolve', kind: 'video' },
  { type: 'dipblack', name: 'Dip to black', kind: 'video' },
  { type: 'dipwhite', name: 'Dip to white', kind: 'video' },
  { type: 'filmdissolve', name: 'Film dissolve', kind: 'video' },
  { type: 'wipeleft', name: 'Wipe left', kind: 'video' },
  { type: 'wiperight', name: 'Wipe right', kind: 'video' },
  { type: 'wipeup', name: 'Wipe up', kind: 'video' },
  { type: 'wipedown', name: 'Wipe down', kind: 'video' },
  { type: 'slideleft', name: 'Slide left', kind: 'video' },
  { type: 'slideright', name: 'Slide right', kind: 'video' },
  { type: 'pushleft', name: 'Push left', kind: 'video' },
  { type: 'pushright', name: 'Push right', kind: 'video' },
  { type: 'iris', name: 'Iris round', kind: 'video' },
  { type: 'zoom', name: 'Zoom in', kind: 'video' },
  { type: 'blurdissolve', name: 'Blur dissolve', kind: 'video' },
  { type: 'crossfade', name: 'Constant power', kind: 'audio' },
  { type: 'crossfadelinear', name: 'Constant gain', kind: 'audio' },
];
export const transitionDef = (type: string): TransitionDef | undefined => TRANSITIONS.find((t) => t.type === type);
