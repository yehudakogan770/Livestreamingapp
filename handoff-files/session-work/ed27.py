import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='GraphEditor.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''// The graph editor: the chosen property's values over time, and the easing
// curve of the segment after the chosen keyframe with its two bezier handles.

import { useRef } from 'react';''','''// The graph editor: the chosen property's values over time on a grid (drag a
// keyframe up and down to change its value, across to move it in time), and
// the easing curve of the segment after the chosen keyframe with its two
// bezier handles.

import { useEffect, useRef, useState } from 'react';''')
rep('''const W = 560;
const H = 200;
const CW = 140;''','''const CW = 140;
/** Room for the value labels on the left and the times along the bottom. */
const AXIS_L = 46;
const AXIS_B = 18;

/** A round step for grid lines: about `n` of them across `span`. */
function niceStep(span: number, n: number): number {
  const raw = span / Math.max(1, n);
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}''')
rep('''  const svg = useRef<SVGSVGElement>(null);
  const curve = useRef<SVGSVGElement>(null);''','''  const svg = useRef<SVGSVGElement>(null);
  const curve = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([560, 200]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize([Math.max(200, el.clientWidth), Math.max(120, el.clientHeight)]));
    ro.observe(el);
    return () => ro.disconnect();
  });''')
rep('''  const X = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const colors = ['#e9e9e6', '#9d9d97'];''','''  const [W, H] = size;
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
  };''')
rep('''        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={`${pi.label} over time`}>
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
        </div>''','''        <div className="tt-graph-plot" ref={box}>
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
                <text x={X(t)} y={H - 5} textAnchor="middle" className="tt-graph-label">
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
        </div>''')
open(p,'w').write(s)

p='designer.css'; s=open(p).read()
rep('''.tt-graph {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
}''','''.tt-graph {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
}
.tt-graph-values {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.tt-graph-plot {
  flex: 1;
  min-height: 120px;
  overflow: hidden;
}
.tt-graph-plot svg {
  display: block;
}
.tt-graph-grid {
  stroke: var(--tt-line);
  stroke-width: 1;
}
.tt-graph-axis {
  stroke: var(--tt-line-2);
}
.tt-graph-label {
  fill: var(--tt-faint);
  font: 10px var(--tt-mono);
}''')
rep('''.tt-graph-key {
  fill: var(--tt-key);
  cursor: pointer;
}''','''.tt-graph-key {
  fill: var(--tt-key);
  cursor: move;
}''')
open(p,'w').write(s)
