// The keyframe graph editor: one property's value (or speed) over the clip.
// Click a key to select it (Shift adds), drag a box to select several, drag
// keys to move them (Shift: in time only), drag bezier handles to shape the
// curve; Ctrl+C / Ctrl+V copy and paste keys, Delete removes them.
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { isAnim, valueAt } from '../model/anim';
import { EASES, handlesOf } from '../model/interp';
import { copiedKeys, copyKeys, keysInBox, moveKeys, pasteKeys, removeKeys, scaleKeyTimes, setEases, setHandle, speedAt } from '../model/keyops';
import type { Anim, Ease, Param } from '../model/types';
import { Scrub } from './controls';

const W = 600;
const H = 200;
const PAD = 14;

type Drag =
  | { kind: 'move'; x0: number; y0: number; orig: Anim; sel: number[]; pxPerFrame: number; valuePerPx: number }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'handle'; t: number; side: 'i' | 'o'; orig: Anim };

export interface GraphProps {
  param: Param | undefined;
  def: number;
  label: string;
  fps: number;
  /** The clip's length (frames). */
  length: number;
  /** The playhead, in frames of the clip. */
  local: number;
  onChange: (p: Param, final: boolean) => void;
  onSeek: (local: number) => void;
}

export function GraphEditor({ param, def, label, fps, length, local, onChange, onSeek }: GraphProps) {
  const [mode, setMode] = useState<'value' | 'speed'>('value');
  const [sel, setSel] = useState<number[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [stretch, setStretch] = useState(100);
  const svg = useRef<SVGSVGElement | null>(null);
  const anim = isAnim(param) ? param : null;
  const keys = anim?.k ?? [];
  const selected = sel.filter((t) => keys.some((k) => k.t === t));

  // What is drawn: the curve sampled across the clip, and the range of values it covers.
  const view = useMemo(() => {
    const t0 = Math.min(0, keys[0]?.t ?? 0);
    const t1 = Math.max(length - 1, keys[keys.length - 1]?.t ?? 0, t0 + 1);
    const n = 240;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      pts.push([t, mode === 'value' ? valueAt(param, t, def) : speedAt(param, t, fps)]);
    }
    let lo = Math.min(...pts.map((p) => p[1]));
    let hi = Math.max(...pts.map((p) => p[1]));
    if (mode === 'value')
      for (const k of keys) {
        lo = Math.min(lo, k.v);
        hi = Math.max(hi, k.v);
      }
    if (hi - lo < 1e-6) {
      lo -= 1;
      hi += 1;
    }
    const m = (hi - lo) * 0.12;
    return { t0, t1, lo: lo - m, hi: hi + m, pts };
  }, [param, def, fps, length, mode, keys]);

  const x = (t: number) => PAD + ((t - view.t0) / (view.t1 - view.t0)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - view.lo) / (view.hi - view.lo)) * (H - PAD * 2);
  const tOf = (px: number) => view.t0 + ((px - PAD) / (W - PAD * 2)) * (view.t1 - view.t0);
  const vOf = (py: number) => view.lo + ((H - PAD - py) / (H - PAD * 2)) * (view.hi - view.lo);

  const point = (e: PointerEvent) => {
    const el = svg.current;
    const m = el?.getScreenCTM?.();
    if (!el || !m) return { px: 0, py: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { px: p.x, py: p.y };
  };

  const down = (e: PointerEvent<SVGSVGElement>) => {
    const { px, py } = point(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ kind: 'box', x0: px, y0: py, x1: px, y1: py });
  };
  const keyDown = (e: PointerEvent, t: number) => {
    e.stopPropagation();
    if (!anim) return;
    const now = e.shiftKey ? (selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]) : selected.includes(t) ? selected : [t];
    setSel(now);
    const { px, py } = point(e);
    (svg.current as Element | null)?.setPointerCapture?.(e.pointerId);
    if (mode === 'value')
      setDrag({
        kind: 'move',
        x0: px,
        y0: py,
        orig: anim,
        sel: now,
        pxPerFrame: (W - PAD * 2) / (view.t1 - view.t0),
        valuePerPx: (view.hi - view.lo) / (H - PAD * 2),
      });
  };
  const handleDown = (e: PointerEvent, t: number, side: 'i' | 'o') => {
    e.stopPropagation();
    if (!anim) return;
    (svg.current as Element | null)?.setPointerCapture?.(e.pointerId);
    setDrag({ kind: 'handle', t, side, orig: anim });
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const { px, py } = point(e);
    if (drag.kind === 'box') setDrag({ ...drag, x1: px, y1: py });
    else if (drag.kind === 'move') {
      const dt = Math.round((px - drag.x0) / drag.pxPerFrame);
      const dv = e.shiftKey ? 0 : -(py - drag.y0) * drag.valuePerPx;
      onChange(moveKeys(drag.orig, drag.sel, dt, dv), false);
    } else {
      const k = drag.orig.k.find((x) => x.t === drag.t);
      if (!k) return;
      const h: [number, number] = [tOf(px) - k.t, vOf(py) - k.v];
      // Handles stay on their side of the key.
      h[0] = drag.side === 'o' ? Math.max(0, h[0]) : Math.min(0, h[0]);
      onChange(setHandle(drag.orig, drag.t, drag.side, h), false);
    }
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const { px, py } = point(e);
    if (drag.kind === 'box') {
      if (Math.abs(px - drag.x0) < 3 && Math.abs(py - drag.y0) < 3) {
        if (!e.shiftKey) setSel([]);
        onSeek(Math.max(0, Math.min(length - 1, Math.round(tOf(px)))));
      } else {
        const inBox =
          mode === 'value'
            ? keysInBox(param, tOf(drag.x0), tOf(px), vOf(drag.y0), vOf(py))
            : keys.filter((k) => k.t >= Math.min(tOf(drag.x0), tOf(px)) && k.t <= Math.max(tOf(drag.x0), tOf(px))).map((k) => k.t);
        setSel(e.shiftKey ? [...new Set([...selected, ...inBox])] : inBox);
      }
    } else if (drag.kind === 'move') {
      const dt = Math.round((px - drag.x0) / drag.pxPerFrame);
      const dv = e.shiftKey ? 0 : -(py - drag.y0) * drag.valuePerPx;
      if (dt !== 0 || Math.abs(dv) > 1e-9) {
        onChange(moveKeys(drag.orig, drag.sel, dt, dv), true);
        setSel(drag.sel.map((t) => t + dt));
      }
    } else if (anim) onChange(anim, true);
    setDrag(null);
  };

  const copy = () => anim && selected.length && copyKeys(anim, selected);
  const paste = () => {
    const next = pasteKeys(param, local);
    if (next !== undefined && next !== param) onChange(next, true);
  };
  const remove = () => {
    if (!anim || !selected.length) return;
    onChange(removeKeys(anim, selected, local), true);
    setSel([]);
  };
  const ease = (e: Ease) => anim && selected.length && onChange(setEases(anim, selected, e), true);
  const scale = () => {
    if (!anim || selected.length < 2) return;
    const pivot = Math.min(...selected);
    onChange(scaleKeyTimes(anim, selected, pivot, stretch / 100), true);
    setSel(selected.map((t) => Math.round(pivot + (t - pivot) * (stretch / 100))));
  };
  const keyboard = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'c') copy();
    else if (mod && e.key.toLowerCase() === 'v') paste();
    else if (mod && e.key.toLowerCase() === 'a') setSel(keys.map((k) => k.t));
    else if (e.key === 'Delete' || e.key === 'Backspace') remove();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const curve = view.pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const selEase = selected.length ? keys.find((k) => k.t === selected[0])?.e : undefined;
  const handles = mode === 'value' ? keys.map((k, i) => ({ k, i, h: handlesOf(keys, i) })).filter(({ k }) => selected.includes(k.t)) : [];

  return (
    <div className="graph" tabIndex={0} onKeyDown={keyboard} aria-label={`Graph of ${label}`}>
      <div className="graph__bar">
        <div className="graph__modes" role="radiogroup" aria-label="Graph">
          {(['value', 'speed'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'is-on' : ''} onClick={() => setMode(m)}>
              {m === 'value' ? 'Value' : 'Speed'}
            </button>
          ))}
        </div>
        <select
          className="text text--sm"
          aria-label="Interpolation of the selected keys"
          disabled={!selected.length}
          value={selEase ?? ''}
          onChange={(e) => ease(e.target.value as Ease)}
        >
          {!selected.length && <option value="">Select keys…</option>}
          {EASES.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--sm" disabled={!selected.length} onClick={copy} title="Copy the selected keys (Ctrl+C)">
          Copy
        </button>
        <button type="button" className="btn btn--sm" disabled={!copiedKeys()} onClick={paste} title="Paste keys at the playhead (Ctrl+V)">
          Paste
        </button>
        <button type="button" className="btn btn--sm" disabled={!selected.length} onClick={remove} title="Delete the selected keys">
          Delete
        </button>
      </div>
      <svg
        ref={svg}
        className="graph__plot"
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={`${label} ${mode === 'value' ? 'value' : 'speed'} graph`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      >
        <rect x={0} y={0} width={W} height={H} className="graph__bg" />
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} className="graph__grid" />
        ))}
        {mode === 'speed' && view.lo < 0 && view.hi > 0 && <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} className="graph__zero" />}
        <line x1={x(local)} x2={x(local)} y1={0} y2={H} className="graph__head" />
        <path d={curve} className="graph__curve" />
        {handles.map(({ k, h }) => (
          <g key={`h${k.t}`}>
            {h.o && keys[keys.indexOf(k)]?.e === 'bezier' && (
              <>
                <line x1={x(k.t)} y1={y(k.v)} x2={x(k.t + h.o[0])} y2={y(k.v + h.o[1])} className="graph__arm" />
                <circle cx={x(k.t + h.o[0])} cy={y(k.v + h.o[1])} r={4} className="graph__handle" onPointerDown={(e) => handleDown(e, k.t, 'o')} />
              </>
            )}
            {h.i && keys[keys.indexOf(k) - 1]?.e === 'bezier' && (
              <>
                <line x1={x(k.t)} y1={y(k.v)} x2={x(k.t + h.i[0])} y2={y(k.v + h.i[1])} className="graph__arm" />
                <circle cx={x(k.t + h.i[0])} cy={y(k.v + h.i[1])} r={4} className="graph__handle" onPointerDown={(e) => handleDown(e, k.t, 'i')} />
              </>
            )}
          </g>
        ))}
        {keys.map((k) =>
          mode === 'value' ? (
            <rect
              key={k.t}
              x={x(k.t) - 5}
              y={y(k.v) - 5}
              width={10}
              height={10}
              transform={`rotate(45 ${x(k.t)} ${y(k.v)})`}
              className={`graph__key${selected.includes(k.t) ? ' is-on' : ''}${k.e === 'hold' ? ' is-hold' : ''}`}
              onPointerDown={(e) => keyDown(e, k.t)}
            >
              <title>{`Frame ${k.t}: ${Number(k.v.toFixed(3))} (${EASES.find((x) => x[0] === k.e)?.[1] ?? k.e})`}</title>
            </rect>
          ) : (
            <line key={k.t} x1={x(k.t)} x2={x(k.t)} y1={PAD} y2={H - PAD} className={`graph__mark${selected.includes(k.t) ? ' is-on' : ''}`} />
          ),
        )}
        {drag?.kind === 'box' && (
          <rect
            x={Math.min(drag.x0, drag.x1)}
            y={Math.min(drag.y0, drag.y1)}
            width={Math.abs(drag.x1 - drag.x0)}
            height={Math.abs(drag.y1 - drag.y0)}
            className="graph__box"
          />
        )}
        <text x={PAD} y={PAD - 3} className="graph__label">
          {mode === 'value' ? Number(view.hi.toFixed(2)) : `${Number(view.hi.toFixed(1))}/s`}
        </text>
        <text x={PAD} y={H - 3} className="graph__label">
          {mode === 'value' ? Number(view.lo.toFixed(2)) : `${Number(view.lo.toFixed(1))}/s`}
        </text>
      </svg>
      <div className="graph__bar">
        <span className="field__label">Stretch keys</span>
        <Scrub value={stretch} min={10} max={1000} step={1} unit="%" label="Stretch the selected keys in time" onChange={(v) => setStretch(v)} />
        <button
          type="button"
          className="btn btn--sm"
          disabled={selected.length < 2}
          onClick={scale}
          title="Stretch the selected keys in time from the first one"
        >
          Apply
        </button>
        <span className="graph__note">
          {anim ? `${selected.length} of ${keys.length} keys selected` : 'Turn keyframes on (◷) to animate this'}
          {selected.length === 1 && anim ? ` · frame ${selected[0]}, ${Number((keys.find((k) => k.t === selected[0])?.v ?? 0).toFixed(3))}` : ''}
        </span>
      </div>
    </div>
  );
}
