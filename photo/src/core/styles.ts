// Layer styles (Photoshop's Layer Style dialog): drop shadow, inner shadow,
// outer glow, inner glow, bevel and emboss, satin, color / gradient /
// pattern overlay and stroke. Drawn by the GPU compositor.

import type { BlendMode } from './blend';
import type { Gradient } from './gradient';
import type { GradientStyle } from './types';

type C3 = [number, number, number];

export interface ShadowFx {
  on: boolean;
  blend: BlendMode;
  color: C3;
  opacity: number;
  angle: number;
  distance: number;
  /** 0..1 */
  spread: number;
  size: number;
  /** Knocks the shadow out under the layer (drop shadow). */
  knockout?: boolean;
}

export interface GlowFx {
  on: boolean;
  blend: BlendMode;
  color: C3;
  opacity: number;
  /** 0..1 (spread for outer, choke for inner). */
  spread: number;
  size: number;
  /** Inner glow: from the edge or the center. */
  source?: 'edge' | 'center';
}

export interface BevelFx {
  on: boolean;
  style: 'inner' | 'outer' | 'emboss' | 'pillow';
  depth: number;
  direction: 'up' | 'down';
  size: number;
  soften: number;
  angle: number;
  altitude: number;
  highlightBlend: BlendMode;
  highlightColor: C3;
  highlightOpacity: number;
  shadowBlend: BlendMode;
  shadowColor: C3;
  shadowOpacity: number;
}

export interface SatinFx {
  on: boolean;
  blend: BlendMode;
  color: C3;
  opacity: number;
  angle: number;
  distance: number;
  size: number;
  invert: boolean;
}

export interface ColorOverlayFx {
  on: boolean;
  blend: BlendMode;
  color: C3;
  opacity: number;
}

export interface GradientOverlayFx {
  on: boolean;
  blend: BlendMode;
  opacity: number;
  gradient: Gradient;
  style: GradientStyle;
  angle: number;
  scale: number;
  reverse: boolean;
}

export interface PatternOverlayFx {
  on: boolean;
  blend: BlendMode;
  opacity: number;
  pattern: string;
  scale: number;
}

export interface StrokeFx {
  on: boolean;
  blend: BlendMode;
  color: C3;
  opacity: number;
  size: number;
  position: 'outside' | 'inside' | 'center';
}

export interface LayerStyles {
  dropShadow?: ShadowFx;
  innerShadow?: ShadowFx;
  outerGlow?: GlowFx;
  innerGlow?: GlowFx;
  bevel?: BevelFx;
  satin?: SatinFx;
  colorOverlay?: ColorOverlayFx;
  gradientOverlay?: GradientOverlayFx;
  patternOverlay?: PatternOverlayFx;
  stroke?: StrokeFx;
  /** All effects shown (the eye next to "Effects"). */
  visible?: boolean;
}

export type StyleKey = Exclude<keyof LayerStyles, 'visible'>;

export const STYLE_ORDER: StyleKey[] = [
  'bevel',
  'stroke',
  'innerShadow',
  'innerGlow',
  'satin',
  'colorOverlay',
  'gradientOverlay',
  'patternOverlay',
  'outerGlow',
  'dropShadow',
];

export const STYLE_NAMES: Record<StyleKey, string> = {
  bevel: 'Bevel & Emboss',
  stroke: 'Stroke',
  innerShadow: 'Inner Shadow',
  innerGlow: 'Inner Glow',
  satin: 'Satin',
  colorOverlay: 'Color Overlay',
  gradientOverlay: 'Gradient Overlay',
  patternOverlay: 'Pattern Overlay',
  outerGlow: 'Outer Glow',
  dropShadow: 'Drop Shadow',
};

export function defaultStyle<K extends StyleKey>(k: K): NonNullable<LayerStyles[K]> {
  const black: C3 = [0, 0, 0];
  const d: Required<Omit<LayerStyles, 'visible'>> = {
    dropShadow: { on: true, blend: 'multiply', color: black, opacity: 0.35, angle: 120, distance: 5, spread: 0, size: 5, knockout: true },
    innerShadow: { on: true, blend: 'multiply', color: black, opacity: 0.35, angle: 120, distance: 5, spread: 0, size: 5 },
    outerGlow: { on: true, blend: 'screen', color: [1, 1, 0.75], opacity: 0.35, spread: 0, size: 5 },
    innerGlow: { on: true, blend: 'screen', color: [1, 1, 0.75], opacity: 0.35, spread: 0, size: 5, source: 'edge' },
    bevel: {
      on: true,
      style: 'inner',
      depth: 1,
      direction: 'up',
      size: 5,
      soften: 0,
      angle: 120,
      altitude: 30,
      highlightBlend: 'screen',
      highlightColor: [1, 1, 1],
      highlightOpacity: 0.75,
      shadowBlend: 'multiply',
      shadowColor: black,
      shadowOpacity: 0.75,
    },
    satin: { on: true, blend: 'multiply', color: black, opacity: 0.5, angle: 19, distance: 11, size: 14, invert: true },
    colorOverlay: { on: true, blend: 'normal', color: [0.85, 0.25, 0.2], opacity: 1 },
    gradientOverlay: {
      on: true,
      blend: 'normal',
      opacity: 1,
      gradient: {
        name: 'Black, White',
        stops: [
          { pos: 0, color: [0, 0, 0] },
          { pos: 1, color: [1, 1, 1] },
        ],
        alphas: [
          { pos: 0, alpha: 1 },
          { pos: 1, alpha: 1 },
        ],
      },
      style: 'linear',
      angle: 90,
      scale: 1,
      reverse: false,
    },
    patternOverlay: { on: true, blend: 'normal', opacity: 1, pattern: 'checker', scale: 1 },
    stroke: { on: true, blend: 'normal', color: black, opacity: 1, size: 3, position: 'outside' },
  };
  return structuredClone(d[k]) as NonNullable<LayerStyles[K]>;
}

/** How far the effects reach beyond the layer's pixels (to redraw enough around a change). */
export function styleReach(s: LayerStyles | undefined): number {
  if (!s || s.visible === false) return 0;
  let r = 0;
  if (s.dropShadow?.on) r = Math.max(r, s.dropShadow.distance + s.dropShadow.size * 2 + 2);
  if (s.outerGlow?.on) r = Math.max(r, s.outerGlow.size * 2 + 2);
  if (s.stroke?.on && s.stroke.position !== 'inside') r = Math.max(r, s.stroke.size + 2);
  if (s.bevel?.on && (s.bevel.style === 'outer' || s.bevel.style === 'emboss' || s.bevel.style === 'pillow')) r = Math.max(r, s.bevel.size * 2 + 2);
  if (s.innerShadow?.on) r = Math.max(r, s.innerShadow.distance + s.innerShadow.size * 2 + 2);
  if (s.innerGlow?.on) r = Math.max(r, s.innerGlow.size * 2 + 2);
  if (s.satin?.on) r = Math.max(r, s.satin.distance + s.satin.size * 2 + 2);
  return Math.ceil(r);
}

export function hasStyles(s: LayerStyles | undefined): boolean {
  if (!s || s.visible === false) return false;
  return STYLE_ORDER.some((k) => s[k]?.on);
}
