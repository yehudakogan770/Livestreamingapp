// Drawing a mask on the viewer: click to add points around what to keep (or
// to limit effects to), drag a point to move it, right-click a point to take
// it away. The shape is kept on the Drawn mask effect, on the frame (0–1
// across and down), and drawn the same in the viewer and the film.
import { useRef, useSyncExternalStore } from 'react';
import { current } from '../model/seq';
import type { Effect } from '../model/types';
import { useDoc, type Doc } from '../doc';
import { drawnShape } from '../render/drawnmask';

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

const pointsOf = (e: Effect | undefined): [number, number][] => (Array.isArray(e?.d?.points) ? (e.d.points as [number, number][]) : []);

/** Change the points of the drawn mask being drawn. */
function setPoints(doc: Doc, d: Drawing, points: [number, number][], label: string, key?: string) {
  const aspect = (() => {
    const s = current(doc.project);
    return s.width / Math.max(1, s.height);
  })();
  doc.edit(
    (p) => ({
      ...p,
      sequences: p.sequences.map((s) =>
        s.id !== p.open
          ? s
          : {
              ...s,
              clips: s.clips.map((c) =>
                c.id !== d.clip ? c : { ...c, effects: c.effects.map((e) => (e.id === d.effect ? { ...e, d: { ...e.d, points, aspect } } : e)) },
              ),
            },
      ),
    }),
    label,
    key,
  );
}

/** The rows under a Drawn mask effect in the Inspector. */
export function DrawnMaskRows({ doc, clip, effect }: { doc: Doc; clip: string; effect: Effect }) {
  const now = useDrawing();
  const on = now?.clip === clip && now.effect === effect.id;
  const n = pointsOf(effect).length;
  return (
    <div className="insp__row">
      <button
        type="button"
        className={`btn btn--sm${on ? ' is-on' : ''}`}
        aria-pressed={on}
        onClick={() => drawMask.start(on ? null : { clip, effect: effect.id })}
      >
        {on ? 'Done drawing' : n ? 'Change the shape' : 'Draw on the picture'}
      </button>
      <span className="insp__note">{n ? `${n} points${n < 3 ? ' (at least 3 make a shape)' : ''}` : 'Click around the area on the viewer.'}</span>
      {n > 0 && (
        <button type="button" className="linkbtn" onClick={() => setPoints(doc, { clip, effect: effect.id }, [], 'Clear the drawn mask')}>
          Clear
        </button>
      )}
    </div>
  );
}

/** Over the viewer while drawing: the shape, its points, and clicks to add points. */
export function DrawMaskOverlay({ doc }: { doc: Doc }) {
  const d = useDrawing();
  const { project } = useDoc(doc);
  const box = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  if (!d) return null;
  const s = current(project);
  const clip = s.clips.find((c) => c.id === d.clip);
  const effect = clip?.effects.find((e) => e.id === d.effect);
  if (!clip || !effect) return null;
  const points = pointsOf(effect);
  const shape = drawnShape(effect.d);
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return [0, 0];
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };
  return (
    <svg
      ref={box}
      className="dmask"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      role="application"
      aria-label="Draw the mask: click to add a point"
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as Element).closest('.dmask__pt')) return;
        setPoints(doc, d, [...points, at(e)], 'Draw a mask point');
      }}
      onPointerMove={(e) => {
        const i = dragging.current;
        if (i === null) return;
        setPoints(
          doc,
          d,
          points.map((p, k) => (k === i ? at(e) : p)),
          'Move a mask point',
          `dmask-${d.effect}-${i}`,
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
              'Remove a mask point',
            );
          }}
        />
      ))}
    </svg>
  );
}
