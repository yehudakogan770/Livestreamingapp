// Lumora Titler graphics as title clips in Lumora Studio: the clip carries
// the project and its field values; the IN plays from the clip's start, the
// OUT ends with the clip, and the picture is drawn by the Titler renderer
// (the same pixels as on air in Lumora) into a texture for the compositor.

import { browserEnv, type BrowserEnv } from '../../../../titler/src/core/browserEnv';
import { renderFrame } from '../../../../titler/src/core/render';
import { clipTime } from '../../../../titler/src/core/timeline';
import { bestFrames, exactVideoEnv } from '../../../../titler/src/core/exactVideo';
import type { BrandTokens, TitleProject, Values } from '../../../../titler/src/core/types';
import { placeClips } from '../model/edit';
import { current } from '../model/seq';
import { newClip, type Project } from '../model/types';
import { mediaUrl } from '../native';
import { clipCueEvents, cueGain, cueMixes } from '../../../../titler/src/core/cues';
import type { Part } from '../export/audioplan';
import type { Sequence } from '../model/types';

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

type ExactEnv = ReturnType<typeof exactVideoEnv>;
/** While exporting: video layers inside titles decoded frame-exact (see prepareTitler). */
let exact: ExactEnv | null = null;

/** Draw a titler clip's picture into a w × h canvas (cleared by the caller). */
export function drawTitler(ctx: CanvasRenderingContext2D, src: TitlerLayerSource, w: number, h: number): void {
  const { t, clock } = titlerTime(src);
  renderFrame(ctx, src.project, { time: t, clock, values: src.values, brand: src.brand, env: exact ?? titlerEnv(), width: w, height: h });
}

const hasVideo = (p: TitleProject) => p.assets.some((a) => a.kind === 'video');

/**
 * Before an export draws a frame: the video frames its title clips need,
 * decoded exactly (WebCodecs), so the drawing that follows uses them.
 * `done` ends the export's exact mode.
 */
export async function prepareTitler(src: TitlerLayerSource, w: number, h: number): Promise<void> {
  if (!hasVideo(src.project) || typeof OffscreenCanvas === 'undefined') return;
  exact ??= exactVideoEnv(titlerEnv(), bestFrames(mediaUrl));
  const c = new OffscreenCanvas(Math.max(1, Math.min(w, 64)), Math.max(1, Math.min(h, 64)));
  // A small dry run finds the frames this one asks for; then they are decoded.
  drawTitler(c.getContext('2d') as unknown as CanvasRenderingContext2D, src, c.width, c.height);
  await exact.settle();
}

/** The export is over: title videos go back to the live player. */
export function endExactTitlers(): void {
  exact?.close();
  exact = null;
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

/** A cue's sound runs on past its marker at most this long (seconds) in an export. */
const CUE_TAIL = 8;

/**
 * The audio cues of the title clips in [from, to): each sound as a piece of
 * the film's sound at its cue's frame (the IN's from the clip's start, the
 * OUT's from where the OUT starts). Cues set to the Hall only are left out
 * (they are for the room, not the film). A sound inside the title is a data
 * URL; the exporter writes it to a file first.
 */
export function titlerCueParts(s: Sequence, from: number, to: number, fps: number): Part[] {
  const out: Part[] = [];
  for (const t of s.tracks) {
    if (t.kind !== 'video' || t.off || t.captions) continue;
    for (const c of s.clips) {
      if (c.track !== t.id || !c.enabled || c.source.kind !== 'titler') continue;
      const project = c.source.project;
      const comp = mainComp(project);
      for (const e of clipCueEvents(project, comp, c.length / fps)) {
        const mixes = cueMixes(e.cue);
        if (!mixes.includes('stream') && !mixes.includes('recording')) continue;
        const at = c.start + Math.round(e.at * fps);
        const stop = Math.min(to, at + Math.round(CUE_TAIL * fps));
        const start = Math.max(from, at);
        if (stop <= start) continue;
        out.push({
          path: e.sound.src,
          track: { ...t, kind: 'audio', volume: 0, pan: 0, role: undefined, off: false, solo: false },
          from: start,
          to: stop,
          srcFrom: (start - at) / fps,
          speed: 1,
          reverse: false,
          envelope: [[0, cueGain(e.cue)]],
          pan: 0,
          effects: [],
          duck: null,
        });
      }
    }
  }
  return out;
}

/** Sounds inside titles (data URLs) that an export must write to files first, with the file name for each. */
export function cueSoundFiles(parts: Part[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const x of parts) {
    if (!x.path.startsWith('data:') || out.has(x.path)) continue;
    const ext = /^data:audio\/(mpeg|mp3)/.test(x.path) ? 'mp3' : /^data:audio\/(ogg|opus)/.test(x.path) ? 'ogg' : /^data:audio\/(mp4|aac|x-m4a)/.test(x.path) ? 'm4a' : 'wav';
    out.set(x.path, `cue-${out.size + 1}.${ext}`);
  }
  return out;
}

/** The bytes of a data URL. */
export function dataUrlBytes(url: string): Uint8Array {
  const comma = url.indexOf(',');
  const body = url.slice(comma + 1);
  if (/;base64$/i.test(url.slice(0, comma))) {
    const bin = atob(body);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}
