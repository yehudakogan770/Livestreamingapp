// Text styles shared across a title (like paragraph styles): a text layer
// linked to a style looks like it; changing the style changes every layer
// linked to it, in every composition. A layer changed by hand keeps its link
// and shows that it differs, until it is reset or the style is updated.

import { uid } from '../core/build';
import type { Layer, TextLayer, TextStyle, TextStyleDef, TitleProject } from '../core/types';
import { mapLayers } from './ops';

const same = (a: TextStyle, b: TextStyle) => JSON.stringify(a) === JSON.stringify(b);

/** Every composition's layers changed by `fn`. */
function everyLayer(p: TitleProject, fn: (l: Layer) => Layer): TitleProject {
  return { ...p, compositions: p.compositions.map((c) => ({ ...c, layers: mapLayers(c.layers, fn) })) };
}

/** A new style from a layer's look; the layer is linked to it. */
export function newTextStyle(p: TitleProject, layerId: string, name: string): { project: TitleProject; id: string } {
  let style: TextStyle | null = null;
  everyLayer(p, (l) => {
    if (l.id === layerId && l.type === 'text') style = l.style;
    return l;
  });
  if (!style) return { project: p, id: '' };
  const id = uid('ts');
  const def: TextStyleDef = { id, name: name.trim() || `Style ${(p.textStyles?.length ?? 0) + 1}`, style: structuredClone(style) };
  const next = everyLayer({ ...p, textStyles: [...(p.textStyles ?? []), def] }, (l) => (l.id === layerId && l.type === 'text' ? { ...l, styleRef: id } : l));
  return { project: next, id };
}

/** Link layers to a style (they take its look). */
export function applyTextStyle(p: TitleProject, ids: string[], styleId: string | null): TitleProject {
  const def = p.textStyles?.find((d) => d.id === styleId);
  return everyLayer(p, (l) => {
    if (!ids.includes(l.id) || l.type !== 'text') return l;
    if (!def) return { ...l, styleRef: null };
    return { ...l, styleRef: def.id, style: structuredClone(def.style) };
  });
}

/** Change a style: every layer linked to it (and not changed by hand) follows. */
export function updateTextStyle(p: TitleProject, styleId: string, style: TextStyle): TitleProject {
  const def = p.textStyles?.find((d) => d.id === styleId);
  if (!def) return p;
  const before = def.style;
  return everyLayer({ ...p, textStyles: p.textStyles!.map((d) => (d.id === styleId ? { ...d, style: structuredClone(style) } : d)) }, (l) =>
    l.type === 'text' && l.styleRef === styleId && same(l.style, before) ? { ...l, style: structuredClone(style) } : l,
  );
}

/** The style takes this layer's look (and the other linked layers follow). */
export function styleFromLayer(p: TitleProject, layer: TextLayer): TitleProject {
  if (!layer.styleRef) return p;
  return updateTextStyle(p, layer.styleRef, layer.style);
}

export function renameTextStyle(p: TitleProject, styleId: string, name: string): TitleProject {
  return { ...p, textStyles: (p.textStyles ?? []).map((d) => (d.id === styleId ? { ...d, name } : d)) };
}

/** Remove a style (its layers keep their look). */
export function removeTextStyle(p: TitleProject, styleId: string): TitleProject {
  return everyLayer({ ...p, textStyles: (p.textStyles ?? []).filter((d) => d.id !== styleId) }, (l) =>
    l.type === 'text' && l.styleRef === styleId ? { ...l, styleRef: null } : l,
  );
}

/** Does a linked layer differ from its style? */
export function differsFromStyle(p: TitleProject, l: TextLayer): boolean {
  const def = l.styleRef ? p.textStyles?.find((d) => d.id === l.styleRef) : undefined;
  return !!def && !same(def.style, l.style);
}
