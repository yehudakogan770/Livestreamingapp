// The graph editor: the chosen property's values over time, and the easing
// curve of the segment after the chosen keyframe with its two bezier handles.

import { useRef } from 'react';
import { EASES, isAnimated, valueAt } from '../core/easing';
import type { Keyframe, Value, Vec2 } from '../core/types';
import { compOf, findLayer, updateLayers } from './ops';
import { getProp, propsOf, withProp } from './props';
import type { Store } from './store';
import { useStore } from './store';

const W = 560;
const H = 200;
const CW = 140;

export function GraphEditor({ store }: { store: Store }) {
  const project = useStore(store, (s) => s.project);
  const compId = useStore(store, (s) => s.compId);
  const graph = useStore(store, (s) => s.graphProp);
  const keys = useStore(store, (s) => s.keys);
  const time = useStore(store, (s) => s.time);
  const svg = useRef<SVGSVGElement>(null);
  const curve = useRef<SVGSVGElement>(null);
  const c = compOf(project, compId);
  const l = graph ? findLayer(c, graph.layer) : undefined;
  const pi = l && graph ? propsOf(l).find((x) => x.path === graph.path) : undefined;
  const prop = l && graph ? getProp(l, graph.path) : undefined;
  if (!l || !pi || !isAnimated(prop) || prop.k.length < 1)
    return (
      <div className="tt-graph-empty">
        Choose an animated property in the timeline (click its name) to see its curve. Select a keyframe to shape the easing after it.
      </div>
    );
  const k = prop.k as Keyframe<Value>[];
  const t0 = Math.min(k[0]!.t, 0);
  const t1 = Math.max(k[k.length - 1]!.t, c.duration);
  const dims = pi.dims;
  const samples: number[][] = [];
  const N = 240;
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    const v = valueAt(prop as never, t, pi.fallback as never) as Value;
    samples.push(Array.isArray(v) ? v : [v]);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) for (const v of s) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  const X = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const colors = ['#e9e9e6', '#9d9d97'];

  // The segment being shaped: after the selected key (or the one before the playhead).
  const sel = keys.find((r) => r.layer === l.id && r.path === pi.path);
  let idx = sel ? k.findIndex((x) => Math.abs(x.t - sel.t) < 1e-6) : -1;
  if (idx < 0) idx = Math.max(0, k.findIndex((x) => x.t > time) - 1);
  if (idx >= k.length - 1) idx = k.length - 2;
  const a = k[idx];
  const b = k[idx + 1];
  const o: Vec2 = a?.o ?? [0, 0];
  const iH: Vec2 = b?.i ?? [1, 1];

  const setHandles = (no: Vec2 | null, ni: Vec2 | null, hold = false) => {
    if (!a || !b) return;
    store.edit('Change easing', (p) =>
      updateLayers(p, c.id, [l.id], (x) => {
        const cur = getProp(x, pi.path);
        if (!isAnimated(cur)) return x;
        const list = cur.k.map((kk) => ({ ...kk }));
        const A = list[idx]!;
        const B = list[idx + 1]!;
        if (hold) A.hold = true;
        else delete A.hold;
        if (no) A.o = no;
        if (ni) B.i = ni;
        return withProp(x, pi.path, { k: list as never });
      }),
    );
  };

  const dragHandle = (which: 'o' | 'i') => (e: React.PointerEvent) => {
    e.preventDefault();
    store.begin('Change easing');
    const el = curve.current!;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = Math.min(1, Math.max(0, (ev.clientX - r.left - 20) / CW));
      const ny = Math.round((1 - (ev.clientY - r.top - 30) / CW) * 100) / 100;
      const v: Vec2 = [Math.round(nx * 100) / 100, Math.min(2, Math.max(-1, ny))];
      if (which === 'o') setHandles(v, null);
      else setHandles(null, v);
    };
    const up = () => {
      store.end();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const cx = (v: number) => 20 + v * CW;
  const cy = (v: number) => 30 + (1 - v) * CW;
  return (
    <div className="tt-graph">
      <div className="tt-graph-values">
        <div className="tt-graph-title">
          {l.name}: {pi.label}
        </div>
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={`${pi.label} over time`}>
          <line x1={X(time)} x2={X(time)} y1={0} y2={H} className="tt-graph-playhead" />
          {Array.from({ length: dims }, (_, d) => (
            <polyline
              key={d}
              fill="none"
              stroke={colors[d]}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              points={samples.map((s, i) => `${(i / N) * W},${Y(s[d]!)}`).join(' ')}
            />
          ))}
          {k.map((kk, i) =>
            (Array.isArray(kk.v) ? kk.v : [kk.v]).map((v, d) => (
              <rect
                key={`${i}-${d}`}
                x={X(kk.t) - 3}
                y={Y(v) - 3}
                width={6}
                height={6}
                className={`tt-graph-key${i === idx ? ' sel' : ''}`}
                onClick={() => store.set({ keys: [{ layer: l.id, path: pi.path, t: kk.t }], time: kk.t })}
              />
            )),
          )}
        </svg>
        <div className="tt-dim tt-small">
          {lo.toFixed(1)} … {hi.toFixed(1)} {pi.unit ?? ''}
        </div>
      </div>
      {a && b && (
        <div className="tt-graph-ease">
          <div className="tt-graph-title">
            Easing {a.t.toFixed(2)} s → {b.t.toFixed(2)} s
          </div>
          <svg ref={curve} width={CW + 40} height={CW + 60} role="img" aria-label="Easing curve">
            <rect x={20} y={30} width={CW} height={CW} className="tt-graph-box" />
            {a.hold ? (
              <polyline points={`${cx(0)},${cy(0)} ${cx(1)},${cy(0)} ${cx(1)},${cy(1)}`} fill="none" className="tt-graph-curve" />
            ) : (
              <>
                <path d={`M${cx(0)} ${cy(0)} C${cx(o[0])} ${cy(o[1])} ${cx(iH[0])} ${cy(iH[1])} ${cx(1)} ${cy(1)}`} fill="none" className="tt-graph-curve" />
                <line x1={cx(0)} y1={cy(0)} x2={cx(o[0])} y2={cy(o[1])} className="tt-graph-arm" />
                <line x1={cx(1)} y1={cy(1)} x2={cx(iH[0])} y2={cy(iH[1])} className="tt-graph-arm" />
                <circle cx={cx(o[0])} cy={cy(o[1])} r={6} className="tt-graph-handle" onPointerDown={dragHandle('o')} aria-label="Leaving handle" />
                <circle cx={cx(iH[0])} cy={cy(iH[1])} r={6} className="tt-graph-handle" onPointerDown={dragHandle('i')} aria-label="Arriving handle" />
              </>
            )}
          </svg>
          <div className="tt-eases">
            {EASES.map((e) => (
              <button
                key={e.id}
                onClick={() => setHandles([...e.o] as Vec2, [...e.i] as Vec2)}
                className={!a.hold && o[0] === e.o[0] && o[1] === e.o[1] && iH[0] === e.i[0] && iH[1] === e.i[1] ? 'on' : ''}
              >
                {e.name}
              </button>
            ))}
            <button onClick={() => setHandles(null, null, true)} className={a.hold ? 'on' : ''}>
              Hold
            </button>
          </div>
          <div className="tt-dim tt-small">
            cubic-bezier({o[0]}, {o[1]}, {iH[0]}, {iH[1]})
          </div>
        </div>
      )}
    </div>
  );
}
