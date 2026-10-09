// Motion tracking and AI masks on the screen: the Tracking section of the
// effect controls, the extra rows of mask effects ("follow a track", "limit
// to"), and the tracker points and paths drawn over the program monitor.
import { DrawnMaskRows } from './DrawMask';
import { Crosshair, Scan, X } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';
import { useDoc, type Doc } from '../doc';
import { updateClips } from '../model/edit';
import { effectDef, MASK_TYPES, newEffect } from '../model/effects';
import { current, end, rate } from '../model/seq';
import { uid, type Clip, type Effect, type Project, type Stabilize, type TrackPath, type TrackPoint } from '../model/types';
import type { Engine } from '../player/engine';
import { TrackJob, type TrackState } from '../track/job';
import {
  finalPlacement,
  frameToPlaced,
  mediaSize,
  pictureToPlaced,
  placedSize,
  placedToFrame,
  placedToPicture,
  poseAt,
  setPoint,
  trackInFrame,
} from '../track/paths';
import { mattes } from '../vision/mattes';
import { modelsNow } from '../vision/segment';
import { Scrub, Section } from './controls';
import { drag } from './hooks';
import './tracking.css';

// ---------------------------------------------------------------------------
// Small shared states: what the viewer is picking, and the track being run.

class Store<T> {
  private listeners = new Set<() => void>();
  constructor(public value: T) {}
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  set(v: T) {
    this.value = v;
    for (const f of this.listeners) f();
  }
  use(): T {
    return useSyncExternalStore(this.subscribe, () => this.value);
  }
}

/** The viewer is waiting for a click (a point, the object) or a box (a region). */
export type Picking = { mode: 'point' | 'region' | 'object'; clip: string; effect?: string } | null;
export const picking = new Store<Picking>(null);

/** The track being run (one at a time). */
const running = new Store<{ job: TrackJob | null; state: TrackState | null }>({ job: null, state: null });

const editClip = (doc: Doc, id: string, label: string, f: (c: Clip) => Clip, key?: string) => doc.edit((p) => updateClips(p, [id], f), label, key);

/** Tracked points added to a path (points set by hand stay as they are). */
function withPoints(path: TrackPath, points: TrackPoint[]): TrackPath {
  const hand = new Set(path.manual ?? []);
  let out = path;
  for (const pt of points) if (!hand.has(pt[0])) out = setPoint(out, pt);
  return out;
}

/** Track a clip's path from the playhead, forward or backward (`then` runs after it ends). */
export function runTrack(doc: Doc, engine: Engine, clipId: string, pathId: string, dir: 1 | -1, then?: () => void) {
  running.value.job?.stop();
  const p = doc.project;
  const s = current(p);
  const clip = s.clips.find((c) => c.id === clipId);
  const path = clip?.paths?.find((x) => x.id === pathId);
  if (!clip || !path) return;
  const from = Math.max(0, Math.min(clip.length - 1, Math.floor(engine.time) - clip.start));
  const job = new TrackJob(
    p,
    clip,
    path,
    rate(s),
    from,
    dir,
    (points) =>
      editClip(doc, clipId, 'Track', (c) => ({ ...c, paths: c.paths?.map((x) => (x.id === pathId ? withPoints(x, points) : x)) }), `track-${pathId}-${dir}`),
    (st) => {
      running.set({ job, state: st });
      if (!st.running) then?.();
    },
  );
  running.set({ job, state: job.state });
  void job.run();
}

const stopTrack = () => running.value.job?.stop();
mattes.tracking = (clip, path) => !!running.value.state?.running && running.value.state.clip === clip && running.value.state.path === path;

/** Wait for a click (or a box) in the viewer, with the playhead on the clip. */
function startPick(engine: Engine, clip: Clip, mode: NonNullable<Picking>['mode'], effect?: string) {
  const t = Math.floor(engine.time);
  if (t < clip.start || t >= end(clip)) {
    engine.pause();
    engine.seek(clip.start);
  }
  picking.set({ mode, clip: clip.id, ...(effect ? { effect } : {}) });
}

// ---------------------------------------------------------------------------
// Turning viewer spots into picture spots and back.

interface View {
  p: Project;
  clip: Clip;
  local: number;
  /** The viewer's frame size on screen, and the sequence's. */
  w: number;
  h: number;
  W: number;
  H: number;
}

/** A spot on the screen (from the frame's top left) as 0–1 of the clip's picture. */
function screenToPicture(v: View, sx: number, sy: number): [number, number] | null {
  const media = mediaSize(v.p, v.clip);
  if (!media) return null;
  const k = v.W / v.w;
  const m = finalPlacement(v.p, v, v.clip, v.local);
  const [x, y] = frameToPlaced(m, (sx - v.w / 2) * k, (sy - v.h / 2) * k);
  const [pw, ph] = placedSize(media.width, media.height, v.clip.motion.fill, v.W, v.H);
  return placedToPicture(x, y, pw, ph);
}

/** A track's place on the screen at a clip frame. */
function trackOnScreen(v: View, pathId: string, local: number): [number, number] | null {
  const at = trackInFrame(v.p, v, v.clip, pathId, local);
  if (!at) return null;
  const k = v.w / v.W;
  return [v.w / 2 + at.x * k, v.h / 2 + at.y * k];
}

/** A region's box on the screen at a clip frame (its four corners). */
function boxOnScreen(v: View, path: TrackPath, local: number): string | null {
  const media = mediaSize(v.p, v.clip);
  const pose = poseAt(path, local);
  if (!media || !pose || !path.box) return null;
  const [pw, ph] = placedSize(media.width, media.height, v.clip.motion.fill, v.W, v.H);
  const [cx, cy] = pictureToPlaced(pose.u, pose.v, pw, ph);
  const hx = (path.box[0] * pw * pose.scale) / 2;
  const hy = (path.box[1] * ph * pose.scale) / 2;
  const a = (pose.angle * Math.PI) / 180;
  const m = finalPlacement(v.p, v, v.clip, local);
  const k = v.w / v.W;
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ]
    .map(([x, y]) => {
      const [X, Y] = placedToFrame(
        m,
        cx + (x as number) * Math.cos(a) - (y as number) * Math.sin(a),
        cy + (x as number) * Math.sin(a) + (y as number) * Math.cos(a),
      );
      return `${v.w / 2 + X * k},${v.h / 2 + Y * k}`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Over the program monitor.

/** Tracker points and paths over the picture (drag a point to fix it at this frame), and picking a spot or a box. */
export function TrackOverlay({ doc, engine, clip, t, w, h }: { doc: Doc; engine: Engine; clip: Clip | null; t: number; w: number; h: number }) {
  const { project } = useDoc(doc);
  const pick = picking.use();
  const s = current(project);
  const picked = pick ? s.clips.find((c) => c.id === pick.clip) : null;
  const target = picked ?? clip;
  if (!target || t < target.start || t >= end(target)) return null;
  const v: View = { p: project, clip: target, local: t - target.start, w, h, W: s.width, H: s.height };
  if (pick && picked) return <Picker doc={doc} engine={engine} pick={pick} v={v} />;
  const paths = target.paths ?? [];
  if (!paths.length) return null;
  return (
    <svg className="trk" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {paths.map((path) => {
        // The path a second and a half each way.
        const line: string[] = [];
        for (let f = Math.max(0, v.local - 45); f <= Math.min(target.length - 1, v.local + 45); f++) {
          const at = trackOnScreen(v, path.id, f);
          if (at) line.push(`${at[0].toFixed(1)},${at[1].toFixed(1)}`);
        }
        const now = trackOnScreen(v, path.id, v.local);
        const box = path.kind === 'region' ? boxOnScreen(v, path, v.local) : null;
        const hand = path.manual?.includes(v.local);
        return (
          <g key={path.id}>
            <polyline className="trk__path" points={line.join(' ')} />
            {box && <polygon className="trk__box" points={box} />}
            {now && (
              <g
                className={`trk__point${hand ? ' is-hand' : ''}`}
                transform={`translate(${now[0]} ${now[1]})`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  e.preventDefault();
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  const pose = poseAt(path, v.local);
                  drag(e, (_dx, _dy, ev) => {
                    const uv = screenToPicture(v, ev.clientX - rect.left, ev.clientY - rect.top);
                    if (!uv) return;
                    const pt: TrackPoint = path.kind === 'region' ? [v.local, uv[0], uv[1], pose?.scale ?? 1, pose?.angle ?? 0] : [v.local, uv[0], uv[1]];
                    editClip(
                      doc,
                      target.id,
                      'Fix tracker point',
                      (c) => ({ ...c, paths: c.paths?.map((x) => (x.id === path.id ? setPoint(x, pt, true) : x)) }),
                      `fix-${path.id}-${v.local}`,
                    );
                  });
                }}
              >
                <title>{`${path.name}: drag to fix it at this frame`}</title>
                <circle r={9} />
                <path d="M -14 0 H -4 M 4 0 H 14 M 0 -14 V -4 M 0 4 V 14" />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Picker({ doc, engine, pick, v }: { doc: Doc; engine: Engine; pick: NonNullable<Picking>; v: View }) {
  const hint =
    pick.mode === 'region'
      ? 'Drag a box around what to follow (something flat with detail works best). Esc: cancel.'
      : pick.mode === 'object'
        ? 'Click the object to select. Esc: cancel.'
        : 'Click the spot to follow (a corner or a mark with detail works best). Esc: cancel.';
  return (
    <div
      className="trk-pick"
      tabIndex={-1}
      ref={(el) => el?.focus()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') picking.set(null);
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const x0 = e.clientX - rect.left;
        const y0 = e.clientY - rect.top;
        const box = e.currentTarget.querySelector('.trk-pick__box') as HTMLElement;
        drag(
          e,
          (_dx, _dy, ev) => {
            if (pick.mode !== 'region') return;
            const x1 = ev.clientX - rect.left;
            const y1 = ev.clientY - rect.top;
            Object.assign(box.style, {
              display: 'block',
              left: `${Math.min(x0, x1)}px`,
              top: `${Math.min(y0, y1)}px`,
              width: `${Math.abs(x1 - x0)}px`,
              height: `${Math.abs(y1 - y0)}px`,
            });
          },
          (ev) => {
            const x1 = ev.clientX - rect.left;
            const y1 = ev.clientY - rect.top;
            picked(doc, engine, pick, v, x0, y0, x1, y1);
          },
        );
      }}
    >
      <span className="trk-pick__hint">{hint}</span>
      <i className="trk-pick__box" />
    </div>
  );
}

/** What was clicked or boxed in the viewer becomes a new track (and for "Select object", its mask's spot). */
function picked(doc: Doc, engine: Engine, pick: NonNullable<Picking>, v: View, x0: number, y0: number, x1: number, y1: number) {
  picking.set(null);
  const region = pick.mode === 'region';
  const cx = region ? (x0 + x1) / 2 : x1;
  const cy = region ? (y0 + y1) / 2 : y1;
  const uv = screenToPicture(v, cx, cy);
  const media = mediaSize(v.p, v.clip);
  if (!uv || !media) return;
  const id = uid('t');
  const n = (v.clip.paths?.length ?? 0) + 1;
  let path: TrackPath;
  if (region) {
    // The box's size in the picture (a small click: a box a sixth of the frame high).
    const k = v.W / v.w;
    const m = finalPlacement(v.p, v, v.clip, v.local);
    const [pw, ph] = placedSize(media.width, media.height, v.clip.motion.fill, v.W, v.H);
    const sx = Math.max(Math.abs(x1 - x0), v.h / 6) * k;
    const sy = Math.max(Math.abs(y1 - y0), v.h / 6) * k;
    const s = Math.max(1e-6, m.scale / 100);
    const box: [number, number] = [Math.min(1, sx / (s * Math.max(1e-6, m.scaleX / 100)) / pw), Math.min(1, sy / s / ph)];
    path = { id, name: `Region ${n}`, kind: 'region', box, points: [[v.local, uv[0], uv[1], 1, 0]], manual: [v.local] };
  } else path = { id, name: pick.mode === 'object' ? `Object ${n}` : `Point ${n}`, kind: 'point', points: [[v.local, uv[0], uv[1]]], manual: [v.local] };
  editClip(doc, v.clip.id, pick.mode === 'object' ? 'Select object' : 'New track', (c) => ({
    ...c,
    paths: [...(c.paths ?? []), path],
    effects: pick.effect ? c.effects.map((e) => (e.id === pick.effect ? { ...e, d: { ...e.d, track: id, seed: uv } } : e)) : c.effects,
  }));
  // The object is followed through the whole clip; its mask is worked out frame by frame after that.
  if (pick.mode === 'object') {
    const effect = pick.effect;
    const masks = () => {
      const c = current(doc.project).clips.find((x) => x.id === v.clip.id);
      if (c && effect) mattes.analyze(doc.project, c, effect, rate(current(doc.project)), v.local, true);
    };
    runTrack(doc, engine, v.clip.id, id, 1, () => runTrack(doc, engine, v.clip.id, id, -1, masks));
  }
}

// ---------------------------------------------------------------------------
// The Tracking section of the effect controls.

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <span className="trk-bar" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
      <i style={{ width: `${total ? (100 * done) / total : 0}%` }} />
    </span>
  );
}

/** Tracks of a clip, steadying it, and attaching it to another clip's track. */
export function TrackingSection({ doc, engine, clip, local, t }: { doc: Doc; engine: Engine; clip: Clip; local: number; t: number }) {
  const { project } = useDoc(doc);
  const run = running.use();
  const s = current(project);
  const media = mediaSize(project, clip);
  const paths = clip.paths ?? [];
  const busy = run.state?.running ? run.state : null;
  const last = run.state && !run.state.running && run.state.clip === clip.id ? run.state : null;
  const set = (label: string, f: (c: Clip) => Clip, key?: string) => editClip(doc, clip.id, label, f, key);
  const st = clip.stabilize ?? null;
  const setSt = (change: Partial<Stabilize>, key?: string) =>
    set('Stabilize', (c) => (c.stabilize ? { ...c, stabilize: { ...c.stabilize, ...change } } : c), key ?? `stab-${clip.id}`);
  // Tracks of other clips in this sequence, to attach to.
  const others = s.clips.filter((c) => c.id !== clip.id && c.paths?.length);
  const fl = clip.follow ?? null;
  if (!media && !others.length && !fl) return null;
  return (
    <Section title="Tracking" open={paths.length > 0 || !!st || !!fl}>
      {media && (
        <>
          <div className="insp__row">
            <button type="button" className="btn btn--sm" title="Follow one spot (its position)" onClick={() => startPick(engine, clip, 'point')}>
              <Crosshair />
              Track a point
            </button>
            <button
              type="button"
              className="btn btn--sm"
              title="Follow a region (its position, size and turn)"
              onClick={() => startPick(engine, clip, 'region')}
            >
              <Scan />
              Track a region
            </button>
          </div>
          {paths.length === 0 && (
            <p className="insp__note">
              Click a spot (or drag a box) in the viewer, then track it forward or backward from the playhead. A mask, a title or a graphic can follow it, or
              the clip can be steadied with it.
            </p>
          )}
        </>
      )}
      {paths.map((path) => {
        const mine = busy && busy.path === path.id ? busy : null;
        const ended = last && last.path === path.id ? last : null;
        const first = path.points[0]?.[0] ?? 0;
        const lastF = path.points[path.points.length - 1]?.[0] ?? 0;
        return (
          <div key={path.id} className="trk-row">
            <div className="insp__row">
              <input
                className="text text--sm trk-row__name"
                value={path.name}
                aria-label="Track name"
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) =>
                  set('Rename track', (c) => ({ ...c, paths: c.paths?.map((x) => (x.id === path.id ? { ...x, name: e.target.value } : x)) }), `name-${path.id}`)
                }
              />
              <span className="insp__note">
                {path.kind === 'region' ? 'Region' : 'Point'} · frames {first + 1}–{lastF + 1}
                {path.manual?.length ? ` · ${path.manual.length} set by hand` : ''}
              </span>
            </div>
            <div className="insp__row">
              {mine ? (
                <>
                  <Progress done={mine.done} total={mine.total} />
                  <button type="button" className="btn btn--sm" onClick={stopTrack}>
                    Stop
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn--sm"
                    title="Track backward from the playhead"
                    disabled={!!busy}
                    onClick={() => runTrack(doc, engine, clip.id, path.id, -1)}
                  >
                    ◂ Track back
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    title="Track forward from the playhead"
                    disabled={!!busy}
                    onClick={() => runTrack(doc, engine, clip.id, path.id, 1)}
                  >
                    Track forward ▸
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    title="Track forward to the end, then backward to the start"
                    disabled={!!busy}
                    onClick={() => runTrack(doc, engine, clip.id, path.id, 1, () => runTrack(doc, engine, clip.id, path.id, -1))}
                  >
                    Both ways
                  </button>
                </>
              )}
              <button
                type="button"
                className="sect__btn"
                title="Delete this track"
                aria-label={`Delete ${path.name}`}
                onClick={() =>
                  set('Delete track', (c) => ({
                    ...c,
                    paths: c.paths?.filter((x) => x.id !== path.id),
                    stabilize: c.stabilize?.path === path.id ? null : c.stabilize,
                    effects: c.effects.map((e) => (e.d?.track === path.id ? { ...e, d: { ...e.d, track: undefined } } : e)),
                  }))
                }
              >
                <X />
              </button>
            </div>
            {ended?.message && <p className="insp__note">{ended.message}</p>}
            <div className="insp__row">
              <button
                type="button"
                className="btn btn--sm"
                title="A blur in a mask that follows this track (a face, a license plate)"
                onClick={() => set('Blur a tracked spot', (c) => blurTracked(project, c, path, local))}
              >
                Blur it
              </button>
              <button
                type="button"
                className="btn btn--sm"
                title="Steady the clip with this track"
                onClick={() =>
                  set('Stabilize', (c) => ({
                    ...c,
                    stabilize: { path: path.id, smooth: 50, lock: false, at: local, crop: true, rotate: true, scale: false },
                  }))
                }
              >
                Stabilize with it
              </button>
            </div>
          </div>
        );
      })}
      {paths.length > 0 && <p className="insp__note">Drag the point in the viewer to fix it at a frame; tracking keeps it and starts again from there.</p>}
      {st && (
        <Section title="Stabilize">
          <div className="insp__row">
            <span className="field__label">Track</span>
            <select className="text text--sm" value={st.path} aria-label="Stabilize with" onChange={(e) => setSt({ path: e.target.value }, '')}>
              {paths.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button type="button" className="sect__btn" title="Stop stabilizing" onClick={() => set('Stabilize off', (c) => ({ ...c, stabilize: null }))}>
              <X />
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={st.lock} onChange={(e) => setSt({ lock: e.target.checked, at: local })} /> No movement (hold it as at this frame)
          </label>
          {!st.lock && (
            <div className="insp__row">
              <span className="field__label">Smoothness</span>
              <Scrub value={st.smooth} min={0} max={100} step={1} label="Smoothness" onChange={(v, final) => setSt({ smooth: v }, final ? '' : undefined)} />
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={st.crop} onChange={(e) => setSt({ crop: e.target.checked })} /> Zoom in so no edge shows (crop to fit)
          </label>
          {paths.find((x) => x.id === st.path)?.kind === 'region' && (
            <div className="insp__row">
              <label className="check">
                <input type="checkbox" checked={st.rotate} onChange={(e) => setSt({ rotate: e.target.checked })} /> Turning
              </label>
              <label className="check">
                <input type="checkbox" checked={st.scale} onChange={(e) => setSt({ scale: e.target.checked })} /> Zooming
              </label>
            </div>
          )}
        </Section>
      )}
      {(others.length > 0 || fl) && (
        <div className="insp__row">
          <span className="field__label">Attach to</span>
          <select
            className="text text--sm"
            value={fl ? `${fl.clip}/${fl.path}` : ''}
            aria-label="Attach to a track"
            onChange={(e) => {
              const [c2, p2] = e.target.value.split('/');
              set('Attach to track', (c) => ({ ...c, follow: c2 && p2 ? { clip: c2, path: p2, at: t, scale: true, rotate: true } : null }));
            }}
          >
            <option value="">Nothing (stays put)</option>
            {others.flatMap((c) =>
              (c.paths ?? []).map((x) => (
                <option key={`${c.id}/${x.id}`} value={`${c.id}/${x.id}`}>
                  {c.name} › {x.name}
                </option>
              )),
            )}
          </select>
        </div>
      )}
      {fl && (
        <>
          <p className="insp__note">It moves with the track, keeping where it is now relative to it. Move it here to change that.</p>
          <div className="insp__row">
            <label className="check">
              <input
                type="checkbox"
                checked={fl.scale}
                onChange={(e) => set('Attach to track', (c) => ({ ...c, follow: c.follow && { ...c.follow, scale: e.target.checked } }))}
              />{' '}
              Grows with a region
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={fl.rotate}
                onChange={(e) => set('Attach to track', (c) => ({ ...c, follow: c.follow && { ...c.follow, rotate: e.target.checked } }))}
              />{' '}
              Turns with it
            </label>
            <button
              type="button"
              className="btn btn--sm"
              title="Keep where it is now, relative to the track"
              onClick={() => set('Attach to track', (c) => ({ ...c, follow: c.follow && { ...c.follow, at: t } }))}
            >
              Set offset here
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

/** A Gaussian blur kept inside a shape mask that follows a track (the classic face blur). */
function blurTracked(p: Project, c: Clip, path: TrackPath, local: number): Clip {
  const s = current(p);
  const f = { W: s.width, H: s.height };
  const at = trackInFrame(p, f, c, path.id, local);
  const media = mediaSize(p, c);
  if (!at || !media) return c;
  const [pw, ph] = placedSize(media.width, media.height, c.motion.fill, f.W, f.H);
  const size = path.box ? [path.box[0] * pw * at.scale, path.box[1] * ph * at.scale] : [f.H * 0.18, f.H * 0.24];
  const mask = newEffect('mask');
  mask.p = {
    ...mask.p,
    cx: (at.x / (f.W / 2)) * 100,
    cy: (at.y / (f.H / 2)) * 100,
    w: ((size[0] as number) / f.H) * 100,
    h: ((size[1] as number) / f.H) * 100,
    feather: 20,
    use: 1,
  };
  mask.d = { track: path.id, trackAt: local };
  const blur = newEffect('blur');
  blur.p.radius = 40;
  blur.d = { limit: { mask: mask.id, outside: false } };
  return { ...c, effects: [...c.effects, mask, blur] };
}

// ---------------------------------------------------------------------------
// Extra rows in effect sections.

/** Rows under an effect: AI mask progress, a shape mask following a track, and "Limit to" a mask. */
export function EffectExtras({ doc, engine, clip, effect, local }: { doc: Doc; engine: Engine; clip: Clip; effect: Effect; local: number }): ReactNode {
  const setD = (d: Record<string, unknown>, label: string) =>
    editClip(doc, clip.id, label, (c) => ({ ...c, effects: c.effects.map((e) => (e.id === effect.id ? { ...e, d: { ...e.d, ...d } } : e)) }));
  if (effect.type === 'personmask' || effect.type === 'objectmask') return <AiMaskRows doc={doc} engine={engine} clip={clip} effect={effect} local={local} />;
  if (effect.type === 'drawnmask') return <DrawnMaskRows doc={doc} clip={clip.id} effect={effect} local={local} />;
  if (effect.type === 'mask') {
    const paths = clip.paths ?? [];
    if (!paths.length) return null;
    const track = typeof effect.d?.track === 'string' ? effect.d.track : '';
    return (
      <>
        <div className="insp__row">
          <span className="field__label">Follow a track</span>
          <select
            className="text text--sm"
            value={track}
            aria-label="Follow a track"
            onChange={(e) => setD({ track: e.target.value || undefined, trackAt: local }, 'Mask follows track')}
          >
            <option value="">No (stays put)</option>
            {paths.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        {track && (
          <p className="insp__note">The mask keeps where it is at frame {Number(effect.d?.trackAt ?? 0) + 1} relative to the track, and moves with it.</p>
        )}
      </>
    );
  }
  if (effectDef(effect.type)?.kind !== 'video') return null;
  return <LimitRow doc={doc} clip={clip} effect={effect} />;
}

function LimitRow({ doc, clip, effect }: { doc: Doc; clip: Clip; effect: Effect }) {
  const masks = clip.effects.filter((e) => MASK_TYPES.includes(e.type));
  if (!masks.length) return null;
  const lim = effect.d?.limit as { mask?: string; outside?: boolean } | undefined;
  const value = lim?.mask ? `${lim.outside ? 'out' : 'in'}:${lim.mask}` : '';
  const name = (e: Effect) => {
    const same = masks.filter((x) => x.type === e.type);
    return `${effectDef(e.type)?.name ?? e.type}${same.length > 1 ? ` ${same.indexOf(e) + 1}` : ''}`;
  };
  return (
    <div className="insp__row">
      <span className="field__label">Limit to</span>
      <select
        className="text text--sm"
        value={value}
        aria-label="Limit to a mask"
        onChange={(e) => {
          const [side, id] = e.target.value.split(':');
          editClip(doc, clip.id, 'Limit to mask', (c) => ({
            ...c,
            effects: c.effects.map((x) => (x.id === effect.id ? { ...x, d: { ...x.d, limit: id ? { mask: id, outside: side === 'out' } : undefined } } : x)),
          }));
        }}
      >
        <option value="">The whole picture</option>
        {masks.flatMap((m) => [
          <option key={`in:${m.id}`} value={`in:${m.id}`}>
            Inside {name(m)}
          </option>,
          <option key={`out:${m.id}`} value={`out:${m.id}`}>
            Outside {name(m)}
          </option>,
        ])}
      </select>
    </div>
  );
}

function AiMaskRows({ doc, engine, clip, effect, local }: { doc: Doc; engine: Engine; clip: Clip; effect: Effect; local: number }) {
  const { project } = useDoc(doc);
  const status = useSyncExternalStore(mattes.subscribe, () => mattes.status(clip.id, effect.id));
  const run = running.use();
  const media = mediaSize(project, clip);
  const object = effect.type === 'objectmask';
  const models = modelsNow();
  const tracking = run.state?.running && run.state.clip === clip.id && run.state.path === effect.d?.track ? run.state : null;
  const seeded = !!effect.d?.seed;
  if (!media) return <p className="insp__note">AI masks work on clips that show a video or a picture.</p>;
  const analyze = () => mattes.analyze(project, clip, effect.id, rate(current(project)), local, true);
  return (
    <>
      {object && (
        <div className="insp__row">
          <button type="button" className="btn btn--sm" onClick={() => startPick(engine, clip, 'object', effect.id)}>
            {seeded ? 'Click the object again…' : 'Click the object in the viewer…'}
          </button>
        </div>
      )}
      {object && (
        <p className="insp__note">
          {!seeded
            ? 'Click the object: Lumora Studio follows that spot through the clip (motion tracking) and, in each frame, asks the AI model which object is under it.'
            : status.how === 'color' || (models && !models.touch)
              ? 'The AI object model could not run on this computer, so the region of the clicked color is picked instead (carried along by tracking). Adjust the color tolerance if it takes too much or too little.'
              : 'Found by the AI object model (MediaPipe interactive segmenter) at the tracked spot in each frame. If it slips, fix the track point in the viewer.'}
        </p>
      )}
      {!object && (
        <p className="insp__note">
          {models && !models.person
            ? 'The AI person model could not run on this computer.'
            : 'People are found by an AI model (MediaPipe selfie segmentation) running on this computer. It works best on people facing the camera; hair edges are soft.'}
        </p>
      )}
      {tracking && (
        <div className="insp__row">
          <span className="field__label">Following</span>
          <Progress done={tracking.done} total={tracking.total} />
          <button type="button" className="btn btn--sm" onClick={stopTrack}>
            Stop
          </button>
        </div>
      )}
      {(!object || seeded) && (
        <div className="insp__row">
          {status.running ? (
            <>
              <span className="field__label">Analyzing</span>
              <Progress done={status.done} total={status.total} />
              <span className="insp__note">
                {status.done} / {status.total}
              </span>
              <button type="button" className="btn btn--sm" onClick={() => mattes.stop(clip.id, effect.id)}>
                Stop
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--sm" title="Work out the mask for every frame now (it is kept for next time)" onClick={analyze}>
                Analyze the whole clip
              </button>
              {status.total > 0 && status.done >= status.total && <span className="insp__note">Every frame is done.</span>}
            </>
          )}
        </div>
      )}
      {status.problem && <p className="insp__note">{status.problem}</p>}
    </>
  );
}
