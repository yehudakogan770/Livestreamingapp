// The graph editor: the chosen property's values over time on a grid (drag a
// keyframe up and down to change its value, across to move it in time), and
// the easing curve of the segment after the chosen keyframe with its two
// bezier handles.

import { useEffect, useRef, useState } from 'react';
import { EASES, fromVelocity, isAnimated, parseCubicBezier, toVelocity, valueAt } from '../core/easing';
import { NumberField } from './fields';
import type { Keyframe, Value, Vec2 } from '../core/types';
import { compOf, findLayer, updateLayers } from './ops';
import { getProp, propsOf, withProp } from './props';
import type { Store } from './store';
import { useStore } from './store';

const CW = 140;
/** Room for the value labels on the left and the times along the bottom. */
const AXIS_L = 46;
const AXIS_B = 18;

/** A round step for grid lines: about `n` of them across `span`. */
function niceStep(span: number, n: number): number {
  const raw = span / Math.max(1, n);
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

export function GraphEditor({ store }: { store: Store }) {
  const project = useStore(store, (s) => s.project);
  const compId = useStore(store, (s) => s.compId);
  const graph = useStore(store, (s) => s.graphProp);
  const keys = useStore(store, (s) => s.keys);
  const time = useStore(store, (s) => s.time);
  const svg = useRef<SVGSVGElement>(null);
  const curve = useRef<SVGSVGElement>(null);
  // The plot takes the room it has (measured, so its lines and labels stay crisp).
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<[number, number]>([560, 200]);
  useEffect(() => {
    if (!box || typeof ResizeObserver === 'undefined') return;
    const measure = () => setSize([Math.max(200, box.clientWidth), Math.max(120, box.clientHeight)]);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    measure();
    return () => ro.disconnect();
  }, [box]);
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
  const [W, H] = size;
  const PW = W - AXIS_L;
  const PH = H - AXIS_B;
  const X = (t: number) => AXIS_L + ((t - t0) / (t1 - t0)) * PW;
  const Y = (v: number) => PH - ((v - lo) / (hi - lo)) * PH;
  const colors = ['#e9e9e6', '#9d9d97'];
  const vStep = niceStep(hi - lo, Math.max(2, Math.floor(PH / 36)));
  const vLines: number[] = [];
  for (let v = Math.ceil(lo / vStep) * vStep; v <= hi; v += vStep) vLines.push(Math.round(v * 1e6) / 1e6);
  const tStep = niceStep(t1 - t0, Math.max(2, Math.floor(PW / 70)));
  const tLines: number[] = [];
  for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1 + 1e-9; t += tStep) tLines.push(Math.round(t * 1e6) / 1e6);
  const fmtV = (v: number) => (Math.abs(vStep) < 1 ? v.toFixed(vStep < 0.1 ? 2 : 1) : String(Math.round(v)));

  /** A keyframe dragged: across moves it in time (by frames), up and down changes that value. */
  const dragKey = (i: number, d: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = svg.current;
    if (!el) return;
    const key = k[i]!;
    store.set({ keys: [{ layer: l.id, path: pi.path, t: key.t }], time: key.t });
    const r0 = el.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const v0 = Array.isArray(key.v) ? [...key.v] : key.v;
    const prevT = k[i - 1]?.t ?? -Infinity;
    const nextT = k[i + 1]?.t ?? Infinity;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dxs = ((ev.clientX - x0) / Math.max(1, r0.width)) * (t1 - t0) * (W / Math.max(1, PW));
      const dv = -((ev.clientY - y0) / Math.max(1, r0.height)) * (hi - lo) * (H / Math.max(1, PH));
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      if (!moved) store.begin('Move keyframe');
      moved = true;
      const frame = 1 / c.fps;
      // Kept between its neighbors, on whole frames.
      const nt = Math.min(nextT - frame, Math.max(prevT + frame, Math.round((key.t + (ev.shiftKey ? 0 : dxs)) / frame) * frame));
      const round = (n: number) => Math.round(n * 100) / 100;
      const nv = Array.isArray(v0) ? v0.map((x, j) => (j === d ? round(x + (ev.altKey ? 0 : dv)) : x)) : round((v0 as number) + (ev.altKey ? 0 : dv));
      store.edit('Move keyframe', (p) =>
        updateLayers(p, c.id, [l.id], (x) => {
          const cur = getProp(x, pi.path);
          if (!isAnimated(cur)) return x;
          const list = cur.k.map((kk, j) => (j === i ? { ...kk, t: Math.max(0, Math.round(nt * 1e6) / 1e6), v: nv } : kk));
          return withProp(x, pi.path, { k: list as never });
        }),
      );
      store.set({ keys: [{ layer: l.id, path: pi.path, t: Math.max(0, Math.round(nt * 1e6) / 1e6) }] });
    };
    const up = () => {
      if (moved) store.end();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

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
        <div className="tt-graph-plot" ref={setBox}>
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${pi.label} over time`}>
            {vLines.map((v) => (
              <g key={`v${v}`}>
                <line x1={AXIS_L} x2={W} y1={Y(v)} y2={Y(v)} className="tt-graph-grid" />
                <text x={AXIS_L - 6} y={Y(v) + 3.5} textAnchor="end" className="tt-graph-label">
                  {fmtV(v)}
                </text>
              </g>
            ))}
            {tLines.map((t) => (
              <g key={`t${t}`}>
                <line x1={X(t)} x2={X(t)} y1={0} y2={PH} className="tt-graph-grid" />
                <text x={X(t)} y={H - 5} textAnchor={X(t) > W - 14 ? 'end' : X(t) < AXIS_L + 10 ? 'start' : 'middle'} className="tt-graph-label">
                  {Number.isInteger(t) ? `${t}s` : t.toFixed(tStep < 0.1 ? 2 : 1)}
                </text>
              </g>
            ))}
            <line x1={AXIS_L} x2={AXIS_L} y1={0} y2={PH} className="tt-graph-axis" />
            <line x1={AXIS_L} x2={W} y1={PH} y2={PH} className="tt-graph-axis" />
            <line x1={X(time)} x2={X(time)} y1={0} y2={PH} className="tt-graph-playhead" />
            {Array.from({ length: dims }, (_, d) => (
              <polyline
                key={d}
                fill="none"
                stroke={colors[d]}
                strokeWidth={1.5}
                points={samples.map((s, i) => `${X(t0 + ((t1 - t0) * i) / N)},${Y(s[d]!)}`).join(' ')}
              />
            ))}
            {k.map((kk, i) =>
              (Array.isArray(kk.v) ? kk.v : [kk.v]).map((v, d) => (
                <rect
                  key={`${i}-${d}`}
                  x={X(kk.t) - 4}
                  y={Y(v) - 4}
                  width={8}
                  height={8}
                  className={`tt-graph-key${i === idx ? ' sel' : ''}`}
                  onPointerDown={dragKey(i, d)}
                >
                  <title>
                    {`${kk.t.toFixed(2)} s: ${Math.round(v * 100) / 100}${pi.unit ?? ''}. Drag up or down for the value, across for the time.`}
                  </title>
                </rect>
              )),
            )}
          </svg>
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
          {!a.hold && <Velocity a={a} b={b} unit={pi.unit} onChange={(h) => setHandles(h.o, h.i)} />}
          <label className="tt-css-ease">
            <span className="tt-dim tt-small">CSS</span>
            <input
              key={`${o.join()}|${iH.join()}`}
              className="tt-input"
              aria-label="Easing as CSS cubic-bezier"
              defaultValue={`cubic-bezier(${o[0]}, ${o[1]}, ${iH[0]}, ${iH[1]})`}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              onBlur={(e) => {
                const h = parseCubicBezier(e.target.value);
                if (h) setHandles(h.o, h.i);
                else e.target.value = `cubic-bezier(${o[0]}, ${o[1]}, ${iH[0]}, ${iH[1]})`;
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** Speeds and influences of the segment (After Effects' Keyframe Velocity), typed in. */
function Velocity({ a, b, unit, onChange }: { a: Keyframe<Value>; b: Keyframe<Value>; unit?: string; onChange: (h: { o: Vec2; i: Vec2 }) => void }) {
  const v = toVelocity(a, b);
  const r = (n: number) => Math.round(n * 100) / 100;
  const set = (patch: Partial<typeof v>) => onChange(fromVelocity(a, b, { ...v, ...patch }));
  const speed = `${unit ?? 'units'}/s`;
  return (
    <div className="tt-velocity" aria-label="Keyframe velocity">
      <span className="tt-dim tt-small">Leaving</span>
      <NumberField label="Leaving speed" value={r(v.outSpeed)} unit={speed} onChange={(n) => set({ outSpeed: n, outInfluence: v.outInfluence || 33.33 })} />
      <NumberField label="Leaving influence" value={r(v.outInfluence)} unit="%" min={0.1} max={100} onChange={(n) => set({ outInfluence: n })} />
      <span className="tt-dim tt-small">Arriving</span>
      <NumberField label="Arriving speed" value={r(v.inSpeed)} unit={speed} onChange={(n) => set({ inSpeed: n, inInfluence: v.inInfluence || 33.33 })} />
      <NumberField label="Arriving influence" value={r(v.inInfluence)} unit="%" min={0.1} max={100} onChange={(n) => set({ inInfluence: n })} />
    </div>
  );
}
