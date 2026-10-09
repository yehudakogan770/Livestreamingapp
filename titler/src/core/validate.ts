// Reading a project from JSON: older versions moved up to this one, anything
// broken repaired (with a note of what was changed), anything unusable refused.

import { DEFAULT_TOKENS } from './binding';
import { cleanMarkers } from './timeline';
import type { Composition, Layer, Prop, TitleProject, Value, Variable } from './types';
import { FORMAT, VERSION } from './types';

export interface ReadResult {
  project: TitleProject | null;
  /** Why it could not be read (project is null). */
  error: string | null;
  /** What was repaired or moved up. */
  notes: string[];
}

const LAYER_TYPES = new Set(['text', 'shape', 'image', 'video', 'group', 'null', 'comp']);
const VAR_TYPES = new Set(['text', 'number', 'color', 'image', 'list']);
const MAX_LAYERS = 2000;
const MAX_COMPS = 200;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Version 1 (the first Titler files): one composition at the top level,
 * `fields` instead of typed variables, markers named `inEnd` / `outStart` on
 * the project.
 */
function fromV1(o: Json, notes: string[]): Json {
  notes.push('Moved up from a version 1 file.');
  const duration = finite(o.duration, 8);
  const comp: Json = {
    id: 'main',
    name: 'Main',
    width: finite(o.width, 1920),
    height: finite(o.height, 1080),
    fps: finite(o.fps, 30),
    duration,
    background: null,
    markers: { inEnd: finite(o.inEnd, 1), outStart: finite(o.outStart, duration - 1), loop: o.loop ?? null },
    cues: [],
    layers: Array.isArray(o.layers) ? o.layers : [],
  };
  const fields = Array.isArray(o.fields) ? o.fields : [];
  return {
    format: FORMAT,
    version: 2,
    id: typeof o.id === 'string' ? o.id : 'p-v1',
    name: typeof o.name === 'string' ? o.name : 'Untitled title',
    category: typeof o.category === 'string' ? o.category : 'Custom',
    main: 'main',
    compositions: [comp],
    variables: fields
      .filter(isObj)
      .map((f) => ({ key: String(f.key ?? ''), label: String(f.label ?? f.key ?? ''), type: 'text', value: String(f.sample ?? '') })),
    tokens: isObj(o.brand) ? o.brand : { ...DEFAULT_TOKENS },
    assets: Array.isArray(o.assets) ? o.assets : [],
  };
}

function cleanProp(p: unknown, fallback: Value, notes: string[], where: string): Prop<Value> {
  const okValue = (v: unknown) =>
    typeof fallback === 'number'
      ? typeof v === 'number' && Number.isFinite(v)
      : Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  // An expression is kept (it is only ever worked out by core/expr.ts, never run).
  const x = isObj(p) && typeof p.x === 'string' && p.x.trim() ? { x: p.x.slice(0, 2000) } : {};
  if (isObj(p) && Array.isArray(p.k)) {
    const k = p.k.filter((x): x is Json => isObj(x) && typeof x.t === 'number' && Number.isFinite(x.t) && okValue(x.v));
    if (k.length !== p.k.length) notes.push(`${where}: removed keyframes that could not be read.`);
    k.sort((a, b) => (a.t as number) - (b.t as number));
    if (!k.length) return { v: fallback, ...x };
    return { k: k as never, ...x };
  }
  if (isObj(p) && okValue(p.v)) return { v: p.v as Value, ...x };
  if (p !== undefined) notes.push(`${where}: a value could not be read and was reset.`);
  return { v: fallback };
}

function cleanLayer(l: Json, comp: Composition, notes: string[], count: { n: number }): Layer | null {
  if (!LAYER_TYPES.has(String(l.type))) {
    notes.push(`A layer of an unknown kind (${String(l.type)}) was left out.`);
    return null;
  }
  if (++count.n > MAX_LAYERS) return null;
  const name = typeof l.name === 'string' ? l.name.slice(0, 120) : String(l.type);
  const where = `Layer "${name}"`;
  const tr = isObj(l.transform) ? l.transform : {};
  const out = {
    ...l,
    id: typeof l.id === 'string' && l.id ? l.id : `l${count.n}`,
    name,
    visible: l.visible !== false,
    start: Math.max(0, finite(l.start, 0)),
    end: finite(l.end, comp.duration),
    transform: {
      anchor: cleanProp(tr.anchor, [0, 0], notes, where),
      position: cleanProp(tr.position, [0, 0], notes, where),
      scale: cleanProp(tr.scale, [100, 100], notes, where),
      rotation: cleanProp(tr.rotation, 0, notes, where),
      opacity: cleanProp(tr.opacity, 100, notes, where),
    },
  } as Json;
  if ((out.end as number) <= (out.start as number)) {
    out.end = Math.max((out.start as number) + 0.04, comp.duration);
    notes.push(`${where}: its end was before its start; it now runs to the end.`);
  }
  if (l.type === 'group') {
    const kids = Array.isArray(l.children) ? l.children : [];
    out.children = kids
      .filter(isObj)
      .map((c) => cleanLayer(c, comp, notes, count))
      .filter((c): c is Layer => !!c);
  }
  if (l.type === 'text') {
    if (typeof l.text !== 'string') out.text = '';
    if (!isObj(l.style)) {
      notes.push(`${where}: its text style was missing and was reset.`);
      out.style = {
        font: '$font',
        weight: 600,
        italic: false,
        size: 56,
        fill: { type: 'solid', color: '$text' },
        tracking: 0,
        lineHeight: 1.2,
        align: 'left',
        vAlign: 'middle',
      };
    } else {
      const st = { ...l.style } as Json;
      st.size = Math.min(2000, Math.max(1, finite(st.size, 56)));
      st.weight = Math.min(1000, Math.max(100, finite(st.weight, 600)));
      st.lineHeight = Math.min(5, Math.max(0.5, finite(st.lineHeight, 1.2)));
      st.tracking = Math.min(500, Math.max(-100, finite(st.tracking, 0)));
      if (!isObj(st.fill)) st.fill = { type: 'solid', color: '$text' };
      out.style = st;
    }
    if (!Array.isArray(l.box)) out.box = [0, 0];
    if (l.fit !== 'shrink') out.fit = 'none';
    out.wrap = l.wrap !== false;
  }
  if (l.type === 'shape') {
    out.shape = ['rect', 'ellipse', 'path'].includes(String(l.shape)) ? l.shape : 'rect';
    out.size = cleanProp(l.size, [100, 100], notes, where);
    out.roundness = cleanProp(l.roundness, 0, notes, where);
    if (out.fill === undefined) out.fill = null;
    if (out.stroke === undefined) out.stroke = null;
  }
  if ((l.type === 'image' || l.type === 'video') && !Array.isArray(l.size)) out.size = [100, 100];
  return out as unknown as Layer;
}

/** A cue marker: its mixes only the known ones, its loudness in range. */
function cleanCue(q: Json): Json {
  const out: Json = { ...q };
  if (out.mixes !== undefined) out.mixes = Array.isArray(out.mixes) ? (out.mixes as unknown[]).filter((m: unknown) => m === 'stream' || m === 'hall' || m === 'recording') : undefined;
  if (out.mixes === undefined) delete out.mixes;
  if (out.gain !== undefined) out.gain = Math.max(-60, Math.min(12, finite(out.gain, 0)));
  return out;
}

function cleanComp(c: Json, notes: string[], count: { n: number }): Composition {
  const duration = Math.min(3600, Math.max(0.1, finite(c.duration, 8)));
  const comp = {
    id: typeof c.id === 'string' && c.id ? c.id : `c${count.n}`,
    name: typeof c.name === 'string' ? c.name.slice(0, 120) : 'Composition',
    width: Math.round(Math.min(8192, Math.max(16, finite(c.width, 1920)))),
    height: Math.round(Math.min(8192, Math.max(16, finite(c.height, 1080)))),
    fps: Math.min(120, Math.max(1, finite(c.fps, 30))),
    duration,
    background: typeof c.background === 'string' ? c.background : null,
    markers: { inEnd: 1, outStart: duration - 1, loop: null },
    cues: Array.isArray(c.cues) ? c.cues.filter(isObj).map(cleanCue) : [],
    layers: [],
    guides: isObj(c.guides) ? c.guides : undefined,
    ...(typeof c.variantOf === 'string' && c.variantOf ? { variantOf: c.variantOf } : {}),
  } as unknown as Composition;
  const m = isObj(c.markers) ? c.markers : {};
  comp.markers = cleanMarkers(
    {
      inEnd: finite(m.inEnd, Math.min(1, duration / 3)),
      outStart: finite(m.outStart, duration - Math.min(1, duration / 3)),
      loop: isObj(m.loop) ? { start: finite(m.loop.start, 0), end: finite(m.loop.end, 0) } : null,
    },
    duration,
  );
  const layers = Array.isArray(c.layers) ? c.layers : [];
  comp.layers = layers
    .filter(isObj)
    .map((l) => cleanLayer(l, comp, notes, count))
    .filter((l): l is Layer => !!l);
  return comp;
}

/** Ids kept apart: a duplicate id gets a new one (its parent and matte links follow the first). */
function uniqueIds(p: TitleProject, notes: string[]) {
  const seen = new Set<string>();
  let n = 0;
  for (const c of p.compositions) {
    const walk = (ls: Layer[]) => {
      for (const l of ls) {
        if (seen.has(l.id)) {
          l.id = `${l.id}-${++n}`;
          notes.push(`Layer "${l.name}" had the same id as another; it was given its own.`);
        }
        seen.add(l.id);
        if (l.type === 'group') walk(l.children);
      }
    };
    walk(c.layers);
  }
}

/** Parents that are missing or would loop are removed. */
function cleanLinks(p: TitleProject, notes: string[]) {
  for (const c of p.compositions) {
    const all = new Map<string, Layer>();
    const walk = (ls: Layer[]) => ls.forEach((l) => (all.set(l.id, l), l.type === 'group' && walk(l.children)));
    walk(c.layers);
    for (const l of all.values()) {
      if (l.parent && (!all.has(l.parent) || l.parent === l.id)) {
        notes.push(`Layer "${l.name}": its parent was not found.`);
        l.parent = null;
      }
      // A loop of parents: the link that closes it is removed.
      const seen = new Set<string>([l.id]);
      let cur = l.parent ? all.get(l.parent) : undefined;
      while (cur) {
        if (seen.has(cur.id)) {
          notes.push(`Layer "${l.name}": its parents went round in a circle.`);
          l.parent = null;
          break;
        }
        seen.add(cur.id);
        cur = cur.parent ? all.get(cur.parent) : undefined;
      }
      if (l.matte && (!all.has(l.matte.layer) || l.matte.layer === l.id)) {
        notes.push(`Layer "${l.name}": its matte layer was not found.`);
        l.matte = null;
      }
      if (l.type === 'comp' && (l.comp === c.id || !p.compositions.some((x) => x.id === l.comp))) {
        notes.push(`Layer "${l.name}": the composition it shows was not found.`);
        l.visible = false;
      }
    }
  }
}

function cleanVariables(list: unknown, notes: string[]): Variable[] {
  if (!Array.isArray(list)) return [];
  const out: Variable[] = [];
  for (const v of list) {
    if (!isObj(v) || typeof v.key !== 'string' || !/^[A-Za-z_][\w.-]*$/.test(v.key)) {
      notes.push('A field with no usable name was left out.');
      continue;
    }
    if (out.some((x) => x.key === v.key)) continue;
    out.push({
      ...(v as unknown as Variable),
      label: typeof v.label === 'string' ? v.label : v.key,
      type: VAR_TYPES.has(String(v.type)) ? (v.type as Variable['type']) : 'text',
      value: typeof v.value === 'string' ? v.value : v.value === undefined ? '' : String(v.value),
    });
  }
  return out;
}

/** Read a project from parsed JSON (any version this app knows). */
export function readProject(input: unknown): ReadResult {
  const notes: string[] = [];
  if (!isObj(input)) return { project: null, error: 'This is not a Lumora Titler file.', notes };
  let o = input;
  if (o.format !== FORMAT) return { project: null, error: 'This is not a Lumora Titler file.', notes };
  const version = finite(o.version, 0);
  if (version > VERSION) return { project: null, error: `This file was made by a newer Lumora Titler (version ${version}). Update the app to open it.`, notes };
  if (version < 1) return { project: null, error: 'This Titler file has no version and cannot be read.', notes };
  if (version === 1) o = fromV1(o, notes);
  const count = { n: 0 };
  const comps = (Array.isArray(o.compositions) ? o.compositions : [])
    .filter(isObj)
    .slice(0, MAX_COMPS)
    .map((c) => cleanComp(c, notes, count));
  if (!comps.length) return { project: null, error: 'This Titler file has no compositions.', notes };
  const tokens = { ...DEFAULT_TOKENS, ...(isObj(o.tokens) ? (o.tokens as object) : {}) };
  const p: TitleProject = {
    format: FORMAT,
    version: VERSION,
    id: typeof o.id === 'string' && o.id ? o.id : 'p',
    name: typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 120) : 'Untitled title',
    category: typeof o.category === 'string' ? o.category : 'Custom',
    description: typeof o.description === 'string' ? o.description : undefined,
    main: typeof o.main === 'string' && comps.some((c) => c.id === o.main) ? o.main : comps[0]!.id,
    compositions: comps,
    variables: cleanVariables(o.variables, notes),
    tokens,
    assets: (Array.isArray(o.assets) ? o.assets : []).filter((a): a is Json => isObj(a) && typeof a.id === 'string' && typeof a.src === 'string') as never,
    data: Array.isArray(o.data) ? (o.data.filter(isObj) as never) : undefined,
    modified: typeof o.modified === 'number' ? o.modified : undefined,
  };
  if (p.main !== o.main && o.main !== undefined) notes.push('The main composition was not found; the first one is used.');
  uniqueIds(p, notes);
  cleanLinks(p, notes);
  return { project: p, error: null, notes };
}

/** Read a project from a file's text. */
export function parseProject(text: string): ReadResult {
  try {
    return readProject(JSON.parse(text));
  } catch {
    return { project: null, error: 'This file could not be read (it is not valid JSON).', notes: [] };
  }
}
