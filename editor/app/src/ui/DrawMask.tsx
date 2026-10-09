// Drawing a mask on the viewer: click to add points around what to keep (or
// to limit effects to), drag a point to move it, right-click a point to take
// it away. The shape is kept on the Drawn mask effect, on the frame (0–1
// across and down), and drawn the same in the viewer and the film. With
// Animate on, changing the shape at a frame keeps that shape for that frame,
// and the mask moves smoothly between the frames you shaped (rotoscoping).
import { useRef, useSyncExternalStore } from 'react';
import { current } from '../model/seq';
import type { Effect } from '../model/types';
import { useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { drawnShape, pointsAt, shapeKeys, withKey } from '../render/drawnmask';
import { usePlayhead } from './hooks';

interface Drawing {
  clip: string;
  effect: string;
}

let drawing: Drawing | null = null;
const listeners = new Set<() => void>();
export const drawMask = {
  start(d: Drawing | null) {
    drawing = d;
    for (const f of listeners) f();
  },
};
export const useDrawing = (): Drawing | null =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => drawing,
  );

const animated = (e: Effect | undefined): boolean => shapeKeys(e?.d).length > 0;

/** Change a drawn mask's settings (its shape, or its shapes over time). */
function setMask(doc: Doc, d: Drawing, change: (e: Effect) => Record<string, unknown>, label: string, key?: string) {
  const s = current(doc.project);
  const aspect = s.width / Math.max(1, s.height);
  doc.edit(
    (p) => ({
      ...p,
      sequences: p.sequences.map((q) =>
        q.id !== p.open
          ? q
          : {
              ...q,
              clips: q.clips.map((c) =>
                c.id !== d.clip ? c : { ...c, effects: c.effects.map((e) => (e.id === d.effect ? { ...e, d: { ...e.d, ...change(e), aspect } } : e)) },
              ),
            },
      ),
    }),
    label,
    key,
  );
}

/** The shape at a frame of the clip set to `points`: the shape itself, or (animating) the shape at that frame. */
function setPoints(doc: Doc, d: Drawing, points: [number, number][], local: number, label: string, key?: string) {
  setMask(doc, d, (e) => (animated(e) ? { keys: withKey(e.d, local, points) } : { points }), label, key);
}

/** The rows under a Drawn mask effect in the Inspector (`local`: the playhead's frame in the clip). */
export function DrawnMaskRows({ doc, clip, effect, local }: { doc: Doc; clip: string; effect: Effect; local: number }) {
  const now = useDrawing();
  const on = now?.clip === clip && now.effect === effect.id;
  const n = pointsAt(effect.d, local).length;
  const keys = shapeKeys(effect.d);
  const me = { clip, effect: effect.id };
  return (
    <>
      <div className="insp__row">
        <button type="button" className={`btn btn--sm${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => drawMask.start(on ? null : me)}>
          {on ? 'Done drawing' : n ? 'Change the shape' : 'Draw on the picture'}
        </button>
        <span className="insp__note">{n ? `${n} points${n < 3 ? ' (at least 3 make a shape)' : ''}` : 'Click around the area on the viewer.'}</span>
        {n > 0 && (
          <button type="button" className="linkbtn" onClick={() => setMask(doc, me, () => ({ points: [], keys: [] }), 'Clear the drawn mask')}>
            Clear
          </button>
        )}
      </div>
      <div className="insp__row">
        <label className="check" title="Shape the mask at different frames; it moves smoothly between them">
          <input
            type="checkbox"
            checked={keys.length > 0}
            disabled={n === 0}
            onChange={(e) =>
              setMask(
                doc,
                me,
                (fx) => (e.target.checked ? { keys: [{ t: local, points: pointsAt(fx.d, local) }] } : { points: pointsAt(fx.d, local), keys: [] }),
                e.target.checked ? 'Animate the drawn mask' : 'Stop animating the drawn mask',
              )
            }
          />{' '}
          Animate
        </label>
        {keys.length > 0 && (
          <span className="insp__note">
            Shaped at {keys.length} {keys.length === 1 ? 'frame' : 'frames'}. Move the playhead and change the shape to add another.
          </span>
        )}
      </div>
    </>
  );
}

/** Over the viewer while drawing: the shape at this frame, its points, and clicks to add points. */
export function DrawMaskOverlay({ doc, engine }: { doc: Doc; engine: Engine }) {
  const d = useDrawing();
  const { project } = useDoc(doc);
  const frame = usePlayhead(engine);
  const box = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  if (!d) return null;
  const s = current(project);
  const clip = s.clips.find((c) => c.id === d.clip);
  const effect = clip?.effects.find((e) => e.id === d.effect);
  if (!clip || !effect) return null;
  const local = Math.max(0, Math.min(clip.length - 1, frame - clip.start));
  const points = pointsAt(effect.d, local);
  const shape = drawnShape(effect.d, local);
  const keyed = shapeKeys(effect.d).some((k) => k.t === local);
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return [0, 0];
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };
  return (
    <svg
      ref={box}
      className={`dmask${animated(effect) && !keyed ? ' is-between' : ''}`}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      role="application"
      aria-label="Draw the mask: click to add a point"
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as Element).closest('.dmask__pt')) return;
        setPoints(doc, d, [...points, at(e)], local, 'Draw a mask point');
      }}
      onPointerMove={(e) => {
        const i = dragging.current;
        if (i === null) return;
        setPoints(
          doc,
          d,
          points.map((p, k) => (k === i ? at(e) : p)),
          local,
          'Move a mask point',
          `dmask-${d.effect}-${local}-${i}`,
        );
      }}
      onPointerUp={() => (dragging.current = null)}
    >
      {points.length > 1 && (
        <polygon
          className={`dmask__shape${shape ? '' : ' is-open'}`}
          points={points.map(([x, y]) => `${x},${y}`).join(' ')}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {points.map(([x, y], i) => (
        <rect
          key={i}
          className="dmask__pt"
          x={x - 0.006}
          y={y - 0.01}
          width={0.012}
          height={0.02}
          vectorEffect="non-scaling-stroke"
          aria-label={`Point ${i + 1}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button === 2) return;
            dragging.current = i;
            (e.currentTarget.ownerSVGElement as SVGSVGElement | null)?.setPointerCapture?.(e.pointerId);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setPoints(
              doc,
              d,
              points.filter((_, k) => k !== i),
              local,
              'Remove a mask point',
            );
          }}
        />
      ))}
    </svg>
  );
}
