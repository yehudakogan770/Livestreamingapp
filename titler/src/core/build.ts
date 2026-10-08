// Making new projects, compositions and layers with sensible defaults.

import { DEFAULT_TOKENS } from './binding';
import { still } from './easing';
import type {
  Composition,
  GroupLayer,
  ImageLayer,
  Layer,
  LayerBase,
  NullLayer,
  ShapeLayer,
  TextLayer,
  TextStyle,
  TitleProject,
  Transform,
  Vec2,
  VideoLayer,
  CompLayer,
} from './types';
import { FORMAT, VERSION } from './types';

let counter = 0;
/** A short id, unique in this session (and practically across files). */
export function uid(prefix = 'l'): string {
  counter = (counter + 1) % 1e6;
  const rnd = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}${rnd}`;
}

export function transformAt(position: Vec2, anchor: Vec2 = [0, 0]): Transform {
  return { anchor: still(anchor), position: still(position), scale: still<Vec2>([100, 100]), rotation: still(0), opacity: still(100) };
}

function base(name: string, comp: Composition | null, position: Vec2): LayerBase {
  return { id: uid(), name, visible: true, start: 0, end: comp?.duration ?? 10, transform: transformAt(position) };
}

export function textStyle(over: Partial<TextStyle> = {}): TextStyle {
  return {
    font: '$font',
    weight: 600,
    italic: false,
    size: 56,
    fill: { type: 'solid', color: '$text' },
    stroke: null,
    tracking: 0,
    lineHeight: 1.2,
    align: 'left',
    vAlign: 'middle',
    ...over,
  };
}

export function newText(
  comp: Composition | null,
  text = 'Text',
  position: Vec2 = [160, 160],
  box: Vec2 = [800, 90],
  style: Partial<TextStyle> = {},
): TextLayer {
  return {
    ...base(text.replace(/\{\{|\}\}/g, '').slice(0, 30) || 'Text', comp, position),
    type: 'text',
    text,
    style: textStyle(style),
    box,
    wrap: true,
    fit: 'shrink',
    minSize: 18,
  };
}

export function newShape(
  comp: Composition | null,
  shape: ShapeLayer['shape'] = 'rect',
  position: Vec2 = [160, 160],
  size: Vec2 = [600, 120],
  color = '$box',
): ShapeLayer {
  return {
    ...base(shape === 'ellipse' ? 'Ellipse' : shape === 'path' ? 'Path' : 'Rectangle', comp, position),
    type: 'shape',
    shape,
    size: still(size),
    roundness: still(0),
    fill: { type: 'solid', color },
    stroke: null,
  };
}

export function newImage(comp: Composition | null, asset: string, size: Vec2, position: Vec2 = [160, 160], name = 'Picture'): ImageLayer {
  return { ...base(name, comp, position), type: 'image', asset, size, fit: 'contain' };
}

export function newVideo(comp: Composition | null, asset: string, size: Vec2, name = 'Video'): VideoLayer {
  return { ...base(name, comp, [0, 0]), type: 'video', asset, size, fit: 'contain', loop: true, offset: 0 };
}

export function newGroup(comp: Composition | null, children: Layer[], name = 'Group'): GroupLayer {
  return { ...base(name, comp, [0, 0]), type: 'group', children };
}

export function newNull(comp: Composition | null, position: Vec2 = [960, 540]): NullLayer {
  return { ...base('Null', comp, position), type: 'null' };
}

export function newCompLayer(comp: Composition | null, inner: Composition): CompLayer {
  return { ...base(inner.name, comp, [0, 0]), type: 'comp', comp: inner.id, offset: 0 };
}

export function newComposition(name = 'Main', width = 1920, height = 1080, fps = 30, duration = 8): Composition {
  return {
    id: uid('c'),
    name,
    width,
    height,
    fps,
    duration,
    background: null,
    markers: { inEnd: 1, outStart: duration - 1, loop: null },
    cues: [],
    layers: [],
  };
}

export function newProject(name = 'Untitled title', width = 1920, height = 1080): TitleProject {
  const comp = newComposition('Main', width, height);
  return {
    format: FORMAT,
    version: VERSION,
    id: uid('p'),
    name,
    category: 'Custom',
    main: comp.id,
    compositions: [comp],
    variables: [],
    tokens: { ...DEFAULT_TOKENS },
    assets: [],
  };
}

/** A deep copy with every layer given a new id (paste, duplicate); parents and mattes follow. */
export function cloneLayers(list: Layer[]): Layer[] {
  const ids = new Map<string, string>();
  const copy = JSON.parse(JSON.stringify(list)) as Layer[];
  const walk = (ls: Layer[]) => {
    for (const l of ls) {
      const fresh = uid();
      ids.set(l.id, fresh);
      l.id = fresh;
      if (l.type === 'group') walk(l.children);
    }
  };
  walk(copy);
  const fix = (ls: Layer[]) => {
    for (const l of ls) {
      if (l.parent) l.parent = ids.get(l.parent) ?? l.parent;
      if (l.matte) l.matte = { ...l.matte, layer: ids.get(l.matte.layer) ?? l.matte.layer };
      if (l.type === 'group') fix(l.children);
    }
  };
  fix(copy);
  return copy;
}
