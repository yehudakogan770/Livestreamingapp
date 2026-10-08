// Lumora Titler graphics as title clips in Lumora Studio: the clip carries
// the project and its field values; the IN plays from the clip's start, the
// OUT ends with the clip, and the picture is drawn by the Titler renderer
// (the same pixels as on air in Lumora) into a texture for the compositor.

import { browserEnv, type BrowserEnv } from '../../../../titler/src/core/browserEnv';
import { renderFrame } from '../../../../titler/src/core/render';
import { clipTime } from '../../../../titler/src/core/timeline';
import type { BrandTokens, TitleProject, Values } from '../../../../titler/src/core/types';
import { placeClips } from '../model/edit';
import { current } from '../model/seq';
import { newClip, type Project } from '../model/types';
import { mediaUrl } from '../native';

/** What a titler clip draws at a frame (see render/frame.ts). */
export interface TitlerLayerSource {
  kind: 'titler';
  project: TitleProject;
  values: Values;
  brand?: Partial<BrandTokens>;
  /** Frames into the clip, and its length. */
  local: number;
  length: number;
  fps: number;
}

let env: BrowserEnv | null = null;
/** Pictures and fonts for title clips (loaded once, kept). */
export function titlerEnv(): BrowserEnv {
  env ??= browserEnv(mediaUrl);
  return env;
}

const mainComp = (p: TitleProject) => p.compositions.find((c) => c.id === p.main) ?? p.compositions[0]!;

/** The composition time a clip shows at a frame. */
export function titlerTime(src: Pick<TitlerLayerSource, 'project' | 'local' | 'length' | 'fps'>): { t: number; clock: number } {
  const c = mainComp(src.project);
  const r = clipTime(c, src.local / src.fps, src.length / src.fps);
  return { t: r.t, clock: src.local / src.fps };
}

const ids = new WeakMap<object, string>();
let next = 0;
const idOf = (o: object) => {
  let id = ids.get(o);
  if (!id) {
    id = `t${++next}`;
    ids.set(o, id);
  }
  return id;
};

const holdCache = new WeakMap<object, boolean>();
/** Does anything change during the HOLD (a keyframe inside it, a loop, a layer starting or ending)? */
function holdMoves(p: TitleProject): boolean {
  let v = holdCache.get(p);
  if (v === undefined) {
    const c = mainComp(p);
    const { inEnd, outStart, loop } = c.markers;
    const inside = (t: number) => t > inEnd + 1e-6 && t < outStart - 1e-6;
    let found = !!loop;
    const walk = (o: unknown) => {
      if (found) return;
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') {
        const r = o as { k?: { t: number }[]; start?: unknown; end?: unknown; comp?: unknown };
        if (Array.isArray(r.k) && r.k.some((k) => inside(k.t))) found = true;
        if (typeof r.start === 'number' && typeof r.end === 'number' && (inside(r.start) || inside(r.end))) found = true;
        if (typeof r.comp === 'string') found = true;
        for (const x of Object.values(o)) walk(x);
      }
    };
    walk(c.layers);
    v = found;
    holdCache.set(p, v);
  }
  return v;
}

/** A key that changes only when the picture does (so a still title is not drawn again every frame). */
export function titlerStamp(src: TitlerLayerSource): string {
  const { t, clock } = titlerTime(src);
  const c = mainComp(src.project);
  // While holding, a title with nothing moving in its HOLD looks the same every frame.
  const holding = t > c.markers.inEnd && t < c.markers.outStart;
  const frame = holding && !holdMoves(src.project) ? -1 : Math.round(t * c.fps);
  const moving = c.layers.some(function scroll(l): boolean {
    return (l.type === 'text' && !!l.scroll) || (l.type === 'group' && l.children.some(scroll)) || l.type === 'video';
  });
  return `${idOf(src.project)}|${idOf(src.values)}|${frame}${moving ? `|${Math.round(clock * c.fps)}` : ''}`;
}

/** Draw a titler clip's picture into a w × h canvas (cleared by the caller). */
export function drawTitler(ctx: CanvasRenderingContext2D, src: TitlerLayerSource, w: number, h: number): void {
  const { t, clock } = titlerTime(src);
  renderFrame(ctx, src.project, { time: t, clock, values: src.values, brand: src.brand, env: titlerEnv(), width: w, height: h });
}

/** A new titler clip at a frame, on the first free video track above V1, as long as the title (at least 3 s). */
export function addTitlerClip(p: Project, at: number, fps: number, project: TitleProject, values: Values = {}): { project: Project; id: string } {
  const s = current(p);
  const c = mainComp(project);
  const length = Math.max(Math.round(fps * 3), Math.round(c.duration * fps));
  const video = s.tracks.filter((t) => t.kind === 'video' && !t.captions);
  const free =
    video.slice(1).find((t) => !t.locked && !s.clips.some((x) => x.track === t.id && x.start < at + length && x.start + x.length > at)) ??
    video[video.length - 1];
  if (!free) return { project: p, id: '' };
  const clip = newClip(free.id, at, length, { kind: 'titler', project, values }, project.name);
  return { project: placeClips(p, [clip], 'overwrite'), id: clip.id };
}

/** The key times of a title (IN end, OUT start, and every keyframe), as frames into a clip `length` frames long. */
export function titlerMarks(project: TitleProject, length: number, fps: number): { inEnd: number; outStart: number } {
  const c = mainComp(project);
  const out = Math.round((c.duration - c.markers.outStart) * fps);
  return { inEnd: Math.min(length, Math.round(c.markers.inEnd * fps)), outStart: Math.max(0, length - out) };
}
