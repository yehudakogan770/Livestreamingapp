// Lumora Titler's document: a project (a .lumtitle file) holding one or more
// compositions of layers, the template's variables, brand tokens and assets.
// Times are seconds; positions and sizes are pixels of the composition.
// Everything here is plain JSON (no classes), so a project is saved, sent and
// compared as it is.

export const FORMAT = 'lumora-title';
export const VERSION = 2;

/** A number or a 2D point, still or keyframed. */
export type Value = number | Vec2;
export type Vec2 = [number, number];

/**
 * How a segment leaves a key and reaches the next: `o` is the leaving key's
 * handle, `i` the arriving key's (cubic bezier in normalized time/value, like
 * CSS cubic-bezier(o[0], o[1], i[0], i[1])). `hold`: the value jumps at the
 * next key.
 */
export interface Keyframe<T extends Value = number> {
  t: number;
  v: T;
  /** Outgoing temporal handle (x 0–1, y may overshoot). Default linear. */
  o?: Vec2;
  /** Incoming temporal handle for the segment that ends here. */
  i?: Vec2;
  hold?: boolean;
  /** Motion paths (points only): spatial tangents relative to the key's value. */
  so?: Vec2;
  si?: Vec2;
}

/** A property: a still value, or keyframes in time order. */
export type Prop<T extends Value = number> = { v: T; k?: undefined } | { k: Keyframe<T>[]; v?: undefined };

/** A color: "#rrggbb", "#rrggbbaa", a brand token ("$accent") or a variable ("{{team_color}}"). */
export type ColorRef = string;

export interface GradientStop {
  at: number;
  color: ColorRef;
}

/** A fill: one color, or a gradient only when the designer picks one. */
export type Paint = { type: 'solid'; color: ColorRef } | { type: 'linear'; angle: number; stops: GradientStop[] } | { type: 'radial'; stops: GradientStop[] };

export interface Stroke {
  paint: Paint;
  width: number;
  join?: 'miter' | 'round' | 'bevel';
  cap?: 'butt' | 'round' | 'square';
  dash?: number[];
}

/** A vertex of a bezier path, with in/out tangents relative to the point. */
export interface PathVertex {
  p: Vec2;
  i?: Vec2;
  o?: Vec2;
}
export interface PathData {
  closed: boolean;
  v: PathVertex[];
}

export interface Transform {
  /** The point (layer space) that position, scale and rotation are about. */
  anchor: Prop<Vec2>;
  position: Prop<Vec2>;
  /** Percent. */
  scale: Prop<Vec2>;
  /** Degrees, clockwise. */
  rotation: Prop;
  /** 0–100. */
  opacity: Prop;
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add';

export interface Mask {
  id: string;
  name: string;
  /** Layer space. */
  path: PathData;
  mode: 'add' | 'subtract' | 'intersect';
  inverted?: boolean;
  /** Soft edge, px. */
  feather?: Prop;
  /** 0–100. */
  opacity?: Prop;
}

/** A track matte: this layer is seen through another layer's alpha or brightness. */
export interface Matte {
  layer: string;
  mode: 'alpha' | 'alphaInverted' | 'luma' | 'lumaInverted';
}

/** Optional effects; none is on by default in a starter template. */
export type Effect =
  | { id: string; type: 'dropShadow'; on: boolean; color: ColorRef; opacity: Prop; angle: number; distance: Prop; softness: Prop }
  | { id: string; type: 'glow'; on: boolean; color: ColorRef; opacity: Prop; radius: Prop }
  | { id: string; type: 'blur'; on: boolean; amount: Prop }
  | { id: string; type: 'fill'; on: boolean; color: ColorRef };

/** Crop/wipe reveal: percent taken off each side of the layer's box. */
export interface Reveal {
  left: Prop;
  right: Prop;
  top: Prop;
  bottom: Prop;
}

export interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked?: boolean;
  /** Shown only when "show shy layers" is on (the designer). */
  shy?: boolean;
  /** The layer it moves with (its transform is relative to the parent's). */
  parent?: string | null;
  /** Comp seconds it starts and ends (the layer bar). */
  start: number;
  end: number;
  transform: Transform;
  reveal?: Reveal;
  /** Blur, px (animatable). */
  blur?: Prop;
  blend?: BlendMode;
  masks?: Mask[];
  matte?: Matte | null;
  effects?: Effect[];
  /** A label color in the designer's layer list. */
  label?: string;
}

/** What text in a range gets: letters, words or lines, one after another. */
export interface TextAnimator {
  id: string;
  name: string;
  by: 'char' | 'word' | 'line';
  /** The selected range (percent of the units), moved along by `offset`. */
  start: Prop;
  end: Prop;
  offset: Prop;
  /** How selection falls off across the range's edge. */
  shape: 'square' | 'rampUp' | 'rampDown' | 'triangle' | 'smooth';
  /** Units counted from the last one back. */
  reverse?: boolean;
  /** Properties at full selection (offsets from the text as set). */
  opacity?: Prop;
  position?: Prop<Vec2>;
  scale?: Prop;
  rotation?: Prop;
  blur?: Prop;
  tracking?: Prop;
  color?: ColorRef;
}

export interface TextStyle {
  font: string;
  weight: number;
  italic: boolean;
  size: number;
  fill: Paint;
  stroke?: Stroke | null;
  /** Extra space between letters, px. */
  tracking: number;
  /** Line height, multiple of the size. */
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  caps?: boolean;
  /** Right-to-left text (Hebrew, Arabic). */
  rtl?: boolean;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  /** Words with {{variables}} and inline styling: [b]bold[/b], [i]italic[/i], [c=$accent]color[/c]. */
  text: string;
  style: TextStyle;
  /** The paragraph box (layer space from 0,0). */
  box: Vec2;
  /** Wrap long lines in the box. */
  wrap: boolean;
  /** Make the text smaller until it fits the box (not below minSize). */
  fit: 'none' | 'shrink';
  minSize?: number;
  /** At most this many lines (0: any). */
  maxLines?: number;
  animators?: TextAnimator[];
  /** A ticker: the line moves left (crawl) or the lines move up (roll), px per second. */
  scroll?: { mode: 'crawl' | 'roll'; speed: number; gap: number } | null;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'path';
  /** Rectangle and ellipse size (layer space from 0,0). */
  size: Prop<Vec2>;
  /** Rectangle corner radius, px. */
  roundness: Prop;
  path?: PathData;
  fill: Paint | null;
  stroke: Stroke | null;
  /** Trim paths: the part of the outline drawn, percent. */
  trim?: { start: Prop; end: Prop; offset: Prop } | null;
  /**
   * A box that follows a text layer's words (lower thirds): its width (and
   * height with `both`) is the words' plus padding, kept left, centered or
   * right as the text is aligned, never smaller than `min`.
   */
  fitTo?: { layer: string; pad: Vec2; min?: Vec2; axis?: 'x' | 'both' } | null;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  /** An asset id, or {{variable}} of type image. */
  asset: string;
  size: Vec2;
  fit: 'contain' | 'cover' | 'stretch';
}

/** A video or an image sequence (the host gives its frames). */
export interface VideoLayer extends LayerBase {
  type: 'video';
  asset: string;
  size: Vec2;
  fit: 'contain' | 'cover' | 'stretch';
  loop: boolean;
  /** Seconds into the video at the layer's start. */
  offset: number;
}

/** Holds other layers; moves, fades and masks them together. */
export interface GroupLayer extends LayerBase {
  type: 'group';
  /** Front first, like the layer list. */
  children: Layer[];
}

/** An invisible layer other layers are parented to. */
export interface NullLayer extends LayerBase {
  type: 'null';
}

/** Another composition placed as one layer (a precomp). */
export interface CompLayer extends LayerBase {
  type: 'comp';
  comp: string;
  /** Comp seconds where the inner composition's 0 is. */
  offset: number;
}

export type Layer = TextLayer | ShapeLayer | ImageLayer | VideoLayer | GroupLayer | NullLayer | CompLayer;
export type LayerType = Layer['type'];

/** Where the IN ends, where OUT starts, and the part repeated while holding. */
export interface Markers {
  inEnd: number;
  outStart: number;
  loop?: { start: number; end: number } | null;
}

export interface CueMarker {
  id: string;
  t: number;
  name: string;
  /** A sound asset played from here (audio cue), or none. */
  sound?: string | null;
}

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Seconds. */
  duration: number;
  /** Transparent when null (graphics go over pictures). */
  background: ColorRef | null;
  markers: Markers;
  cues: CueMarker[];
  /** Front first. */
  layers: Layer[];
  guides?: { x: number[]; y: number[] };
}

export type VariableType = 'text' | 'number' | 'color' | 'image' | 'list';

/** A template field the operator fills in: {{key}} in text, colors and images. */
export interface Variable {
  key: string;
  label: string;
  type: VariableType;
  /** The sample value shown while designing (and the default). */
  value: string;
  /** Choices offered to the operator (a list of names, colors…). */
  options?: string[];
  /** Number: decimals, and words before and after. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** List: what goes between the items when shown on one line (a ticker); one item a line when left out. */
  separator?: string;
  /** The control panel's section. */
  group?: string;
  /** Lumora fills it from here (data file column, scoreboard, countdown…). */
  bind?: string;
}

/** The look of the event: graphics ask for "$accent" and get the event's color. */
export interface BrandTokens {
  font: string;
  fontSub: string;
  text: string;
  textSub: string;
  accent: string;
  accentText: string;
  box: string;
  boxAlt: string;
}

export interface Asset {
  id: string;
  name: string;
  kind: 'image' | 'svg' | 'video' | 'sequence' | 'audio' | 'font';
  /** A data: URL (embedded in the package) or a file path / URL. */
  src: string;
  width?: number;
  height?: number;
  /** Image sequence: frame files and rate. */
  frames?: string[];
  fps?: number;
  /** Font: the family it adds. */
  family?: string;
}

export interface DataSource {
  id: string;
  name: string;
  kind: 'csv' | 'sheet' | 'json';
  url: string;
  /** Seconds between reads (0: once). */
  refresh: number;
  /** Which row fills the variables (from 0). */
  row: number;
  /** Variable key → column name. */
  map: Record<string, string>;
}

export interface TitleProject {
  format: typeof FORMAT;
  version: typeof VERSION;
  id: string;
  name: string;
  category: string;
  description?: string;
  /** The composition played on air. */
  main: string;
  compositions: Composition[];
  variables: Variable[];
  tokens: BrandTokens;
  assets: Asset[];
  data?: DataSource[];
  modified?: number;
}

/** Values for the variables ({{key}} → words). */
export type Values = Record<string, string>;
