// The canvas: the composition drawn at the playhead, safe areas, guides,
// rulers, the selection with its handles, motion paths, snapping, and the
// tools (select, text, rectangle, ellipse, pen, hand).

import { timerRunning } from '../core/timer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newShape, newText } from '../core/build';
import type { BrowserEnv } from '../core/browserEnv';
import { isAnimated, num, vec } from '../core/easing';
import { apply, invert } from '../core/matrix';
import { groupOf, layerIndex, renderFrame, type Ctx } from '../core/render';
import { cueTime } from '../core/timeline';
import type { CanvasNote, Layer, PathVertex, Vec2 } from '../core/types';
import { hitLayer, layerBounds, layerBox, layerCorners, setAt, toParent, type Look } from './geometry';
import { addLayers, boundsOf, compOf, findLayer, flatLayers, updateComp, updateLayers, type Box } from './ops';
import type { EditorState, Store } from './store';
import { useStore } from './store';
import { worldMatrix } from '../core/render';
import type { RamPreview } from './ramPreview';

/** The composition time and the take clock shown now (a "take" preview runs on its own clock). */
export function shownTime(s: EditorState, now: number): { t: number; clock: number } {
  const c = compOf(s.project, s.compId);
  if (s.cue) {
    const r = cueTime(c, (now - s.cue.inAt) / 1000, s.cue.outAt === null ? null : (now - s.cue.outAt) / 1000);
    return { t: r.t, clock: (now - s.cue.inAt) / 1000 };
  }
  return { t: s.time, clock: s.time };
}

export const lookOf = (s: EditorState): Look => ({ project: s.project, comp: compOf(s.project, s.compId), t: s.time, values: s.values, brand: s.brand });

const RULER = 20;
const SNAP_PX = 6;
const HANDLE = 7;

type Drag =
  | { kind: 'move'; start: Vec2; orig: Map<string, Layer>; box: Box | null; axis: 'x' | 'y' | null }
  | { kind: 'scale'; layer: Layer; handle: [number, number]; start: Vec2 }
  | { kind: 'rotate'; layer: Layer; center: Vec2; start: number }
  | { kind: 'marquee'; start: Vec2; now: Vec2; add: boolean }
  | { kind: 'draw'; shape: 'rect' | 'ellipse'; start: Vec2; now: Vec2 }
  | { kind: 'pan'; start: Vec2; pan: Vec2 }
  | { kind: 'pen'; at: Vec2 }
  | { kind: 'guide'; axis: 'x' | 'y'; index: number }
  | { kind: 'anchor'; layer: Layer; start: Vec2 };

interface View {
  scale: number;
  ox: number;
  oy: number;
  dpr: number;
}

export function Viewport({ store, env, ram }: { store: Store; env: BrowserEnv; ram?: RamPreview | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ scale: 0.5, ox: 0, oy: 0, dpr: 1 });
  const drag = useRef<Drag | null>(null);
  const snapLines = useRef<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const pen = useRef<PathVertex[]>([]);
  const [size, setSize] = useState<[number, number]>([800, 450]);
  const [, force] = useState(0);
  const tool = useStore(store, (s) => s.tool);
  const playing = useStore(store, (s) => s.playing);
  const cue = useStore(store, (s) => s.cue);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setSize([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d') as Ctx | null;
    if (!ctx) return;
    const s = store.get();
    const c = compOf(s.project, s.compId);
    const dpr = typeof devicePixelRatio === 'number' ? Math.min(3, devicePixelRatio) : 1;
    const [W, H] = size;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const left = s.show.rulers ? RULER : 0;
    const fit = Math.min((W - left - 48) / c.width, (H - left - 48) / c.height);
    const scale = s.zoom > 0 ? s.zoom : Math.max(0.02, fit);
    const ox = left + (W - left - c.width * scale) / 2 + s.pan[0];
    const oy = left + (H - left - c.height * scale) / 2 + s.pan[1];
    view.current = { scale, ox, oy, dpr };
    const css = getComputedStyle(cv);
    const col = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = col('--tt-work', '#0e0e0e');
    ctx.fillRect(0, 0, cv.width, cv.height);
    // The composition: a quiet checkerboard where it is see-through.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = c.width * scale;
    const ch = c.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, cw, ch);
    ctx.clip();
    const sq = 12;
    ctx.fillStyle = '#262626';
    ctx.fillRect(ox, oy, cw, ch);
    ctx.fillStyle = '#2e2e2e';
    for (let y = 0; y * sq < ch; y++) for (let x = (y % 2) * 1; x * sq < cw; x += 2) ctx.fillRect(ox + x * sq, oy + y * sq, sq, sq);
    ctx.restore();
    const now = performance.now();
    const { t, clock } = shownTime(s, now);
    ctx.save();
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    ctx.clip();
    if (ram) ram.scale = Math.min(1, scale * dpr);
    // Playing: frames the RAM preview already made are shown as they are (full speed on heavy titles).
    const kept = s.playing && ram ? ram.frameAt(t) : null;
    try {
      if (kept) ctx.drawImage(kept, 0, 0, c.width, c.height);
      else renderFrame(ctx, s.project, { comp: c.id, time: t, clock, values: s.values, brand: s.brand ?? undefined, env });
    } catch {
      /* a frame that cannot be drawn leaves the checkerboard */
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = (p: Vec2): Vec2 => [ox + p[0] * scale, oy + p[1] * scale];
    // Outside the frame, dimmed.
    ctx.strokeStyle = col('--tt-line-2', '#3a3a37');
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, cw + 1, ch + 1);
    if (s.show.safe) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.setLineDash([4, 4]);
      for (const k of [0.93, 0.9]) {
        const w = cw * k;
        const h = ch * k;
        ctx.strokeRect(ox + (cw - w) / 2 + 0.5, oy + (ch - h) / 2 + 0.5, w, h);
      }
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ox + cw / 2 - 10, oy + ch / 2 + 0.5);
      ctx.lineTo(ox + cw / 2 + 10, oy + ch / 2 + 0.5);
      ctx.moveTo(ox + cw / 2 + 0.5, oy + ch / 2 - 10);
      ctx.lineTo(ox + cw / 2 + 0.5, oy + ch / 2 + 10);
      ctx.stroke();
    }
    if (s.show.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      const step = 60;
      for (let x = step; x < c.width; x += step) {
        ctx.moveTo(Math.round(ox + x * scale) + 0.5, oy);
        ctx.lineTo(Math.round(ox + x * scale) + 0.5, oy + ch);
      }
      for (let y = step; y < c.height; y += step) {
        ctx.moveTo(ox, Math.round(oy + y * scale) + 0.5);
        ctx.lineTo(ox + cw, Math.round(oy + y * scale) + 0.5);
      }
      ctx.stroke();
    }
    if (s.show.guides && c.guides) {
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.75)';
      ctx.beginPath();
      for (const x of c.guides.x) {
        ctx.moveTo(Math.round(ox + x * scale) + 0.5, 0);
        ctx.lineTo(Math.round(ox + x * scale) + 0.5, H);
      }
      for (const y of c.guides.y) {
        ctx.moveTo(0, Math.round(oy + y * scale) + 0.5);
        ctx.lineTo(W, Math.round(oy + y * scale) + 0.5);
      }
      ctx.stroke();
    }
    // Selection.
    const look: Look = { ...lookOf(s), t };
    const sel = store.selected();
    ctx.strokeStyle = col('--tt-select', '#e9e9e6');
    for (const l of sel) {
      const pts = layerCorners(look, l).map(P);
      if (!pts.length) continue;
      ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();
    }
    const main = sel[0];
    if (main && sel.length === 1 && main.type !== 'group' && !main.locked) {
      const pts = layerCorners(look, main).map(P);
      ctx.fillStyle = col('--tt-panel', '#1c1c1b');
      for (const h of handlePoints(pts)) {
        ctx.fillRect(h[0] - HANDLE / 2, h[1] - HANDLE / 2, HANDLE, HANDLE);
        ctx.strokeRect(h[0] - HANDLE / 2 + 0.5, h[1] - HANDLE / 2 + 0.5, HANDLE - 1, HANDLE - 1);
      }
      // The anchor point.
      const m = worldMatrix(c, main, t, layerIndex(c), groupOf(c));
      const a = P(apply(m, vec(main.transform.anchor, t, [0, 0])));
      ctx.beginPath();
      ctx.arc(a[0], a[1], 5, 0, Math.PI * 2);
      ctx.moveTo(a[0] - 9, a[1]);
      ctx.lineTo(a[0] + 9, a[1]);
      ctx.moveTo(a[0], a[1] - 9);
      ctx.lineTo(a[0], a[1] + 9);
      ctx.stroke();
      // The motion path: where the anchor goes over time, the keys as dots.
      if (s.show.motionPaths && isAnimated(main.transform.position)) {
        const keys = main.transform.position.k!;
        const t0 = keys[0]!.t;
        const t1 = keys[keys.length - 1]!.t;
        ctx.strokeStyle = 'rgba(233,233,230,0.55)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        const steps = 60;
        for (let i = 0; i <= steps; i++) {
          const tt = t0 + ((t1 - t0) * i) / steps;
          const mm = worldMatrix(c, main, tt, layerIndex(c), groupOf(c));
          const q = P(apply(mm, vec(main.transform.anchor, tt, [0, 0])));
          if (i) ctx.lineTo(q[0], q[1]);
          else ctx.moveTo(q[0], q[1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col('--tt-select', '#e9e9e6');
        for (const k of keys) {
          const mm = worldMatrix(c, main, k.t, layerIndex(c), groupOf(c));
          const q = P(apply(mm, vec(main.transform.anchor, k.t, [0, 0])));
          ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6);
        }
      }
    }
    // Snap lines while dragging.
    ctx.strokeStyle = 'rgba(255, 92, 92, 0.9)';
    ctx.beginPath();
    for (const x of snapLines.current.x) {
      ctx.moveTo(Math.round(ox + x * scale) + 0.5, oy - 20);
      ctx.lineTo(Math.round(ox + x * scale) + 0.5, oy + ch + 20);
    }
    for (const y of snapLines.current.y) {
      ctx.moveTo(ox - 20, Math.round(oy + y * scale) + 0.5);
      ctx.lineTo(ox + cw + 20, Math.round(oy + y * scale) + 0.5);
    }
    ctx.stroke();
    const d = drag.current;
    if (d?.kind === 'marquee' || d?.kind === 'draw') {
      const a = P(d.start);
      const b = P(d.now);
      ctx.strokeStyle = col('--tt-select', '#e9e9e6');
      ctx.setLineDash(d.kind === 'marquee' ? [4, 3] : []);
      if (d.kind === 'draw' && d.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else ctx.strokeRect(Math.min(a[0], b[0]) + 0.5, Math.min(a[1], b[1]) + 0.5, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ctx.setLineDash([]);
    }
    // The path being drawn with the pen.
    if (pen.current.length) {
      ctx.strokeStyle = col('--tt-select', '#e9e9e6');
      ctx.beginPath();
      const v = pen.current;
      const first = P(v[0]!.p);
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < v.length; i++) {
        const a = v[i - 1]!;
        const b = v[i]!;
        const c1 = P([a.p[0] + (a.o?.[0] ?? 0), a.p[1] + (a.o?.[1] ?? 0)]);
        const c2 = P([b.p[0] + (b.i?.[0] ?? 0), b.p[1] + (b.i?.[1] ?? 0)]);
        const e = P(b.p);
        ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
      }
      ctx.stroke();
      ctx.fillStyle = col('--tt-panel', '#1c1c1b');
      for (const q of v) {
        const p = P(q.p);
        ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6);
        ctx.strokeRect(p[0] - 3, p[1] - 3, 6, 6);
      }
    }
    if (s.show.notes) {
      // Notes pinned on the canvas: numbered tags (open ones solid, done ones outlined).
      (s.project.notes ?? [])
        .filter((n) => n.comp === c.id)
        .forEach((n, i) => {
          const [x, y] = P([n.x, n.y]);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.arc(x + 11, y - 11, 10, Math.PI * 0.6, Math.PI * 2.4);
          ctx.closePath();
          ctx.fillStyle = n.done ? 'rgba(40,40,38,0.9)' : n.id === s.editingNote ? '#f2c94c' : '#e8b931';
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = n.done ? '#bbb' : '#111';
          ctx.font = '600 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(i + 1), x + 11, y - 11);
          ctx.restore();
        });
    }
    if (s.show.rulers) drawRulers(ctx, W, H, scale, ox, oy, col);
  }, [store, env, size, ram]);

  // A timer field running (the control panel's Start): the canvas follows it.
  const ticking = useStore(store, (s) => s.project.variables.some((v) => v.type === 'timer' && timerRunning(s.values[v.key] ?? v.value)));
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => requestAnimationFrame(draw), 100);
    return () => clearInterval(id);
  }, [ticking, draw]);

  // Draw on every change, and every frame while playing or previewing a take.
  useEffect(() => {
    let raf = 0;
    const ask = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    ask();
    const un1 = store.subscribe(ask);
    const un2 = env.onReady(ask);
    let loop = 0;
    if (playing || cue) {
      const tick = () => {
        draw();
        loop = requestAnimationFrame(tick);
      };
      loop = requestAnimationFrame(tick);
    }
    return () => {
      un1();
      un2();
      cancelAnimationFrame(raf);
      cancelAnimationFrame(loop);
    };
  }, [draw, store, env, playing, cue]);

  const toComp = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = canvas.current!.getBoundingClientRect();
    const v = view.current;
    return [(e.clientX - r.left - v.ox) / v.scale, (e.clientY - r.top - v.oy) / v.scale];
  };

  const onDown = (e: React.PointerEvent) => {
    const s = store.get();
    const p = toComp(e);
    const c = compOf(s.project, s.compId);
    const look = lookOf(s);
    canvas.current?.setPointerCapture?.(e.pointerId);
    const r = canvas.current!.getBoundingClientRect();
    const local: Vec2 = [e.clientX - r.left, e.clientY - r.top];
    // Rulers: drag a guide out.
    if (s.show.rulers && (local[0] < RULER || local[1] < RULER)) {
      const axis = local[1] < RULER ? 'y' : 'x';
      const guides = c.guides ?? { x: [], y: [] };
      store.begin('Add guide');
      const list = [...guides[axis], axis === 'x' ? p[0] : p[1]];
      store.edit('Add guide', (pr) => updateComp(pr, c.id, (cc) => ({ ...cc, guides: { ...guides, [axis]: list } })));
      drag.current = { kind: 'guide', axis, index: list.length - 1 };
      return;
    }
    if (tool === 'hand' || e.button === 1 || spaceDown.current) {
      drag.current = { kind: 'pan', start: [e.clientX, e.clientY], pan: s.pan };
      return;
    }
    if (tool === 'note') {
      const note: CanvasNote = { id: `n${Date.now().toString(36)}`, comp: c.id, x: Math.round(p[0]), y: Math.round(p[1]), text: '', at: Date.now() };
      store.edit('Add note', (pr) => ({ ...pr, notes: [...(pr.notes ?? []), note] }), { tool: 'select', editingNote: note.id });
      return;
    }
    if (s.show.notes && tool === 'select') {
      // A click on a note's tag opens it.
      const hit = (s.project.notes ?? []).find(
        (n) => n.comp === c.id && dist([n.x + 11 / view.current.scale, n.y - 11 / view.current.scale], p) * view.current.scale < 11,
      );
      if (hit) {
        store.set({ editingNote: hit.id });
        return;
      }
    }
    if (tool === 'text') {
      const l = newText(c, 'Text', [Math.round(p[0]), Math.round(p[1])], [800, 90]);
      l.end = c.duration;
      store.edit('Add text', (pr) => addLayers(pr, c.id, [l], s.selection[0] ?? null), { selection: [l.id], tool: 'select', editingText: l.id });
      return;
    }
    if (tool === 'rect' || tool === 'ellipse') {
      drag.current = { kind: 'draw', shape: tool, start: p, now: p };
      return;
    }
    if (tool === 'pen') {
      const v = pen.current;
      if (v.length > 2 && dist(v[0]!.p, p) * view.current.scale < 8) {
        finishPen(true);
        return;
      }
      pen.current = [...v, { p }];
      drag.current = { kind: 'pen', at: p };
      force((n) => n + 1);
      return;
    }
    // Select tool: a guide, a handle of the selected layer, a layer, or the empty canvas.
    if (s.show.guides && c.guides) {
      for (const axis of ['x', 'y'] as const) {
        const i = c.guides[axis].findIndex((g) => Math.abs((axis === 'x' ? p[0] : p[1]) - g) * view.current.scale < 4);
        if (i >= 0) {
          store.begin('Move guide');
          drag.current = { kind: 'guide', axis, index: i };
          return;
        }
      }
    }
    const sel = store.selected();
    const main = sel[0];
    if (main && sel.length === 1 && main.type !== 'group' && !main.locked) {
      const pts = layerCorners(look, main);
      const scr = pts.map((q): Vec2 => [q[0] * view.current.scale, q[1] * view.current.scale]);
      const at: Vec2 = [p[0] * view.current.scale, p[1] * view.current.scale];
      const hs = handlePoints(scr);
      const hi = hs.findIndex((h) => Math.abs(h[0] - at[0]) <= HANDLE && Math.abs(h[1] - at[1]) <= HANDLE);
      if (hi >= 0) {
        store.begin('Resize');
        drag.current = { kind: 'scale', layer: main, handle: HANDLE_DIRS[hi]!, start: p };
        return;
      }
      // Just outside a corner: turn it.
      const near = scr.some((q) => dist(q, at) < 22) && !inside(scr, at);
      if (near) {
        const m = worldMatrix(c, main, s.time, layerIndex(c), groupOf(c));
        const center = apply(m, vec(main.transform.anchor, s.time, [0, 0]));
        store.begin('Rotate');
        drag.current = { kind: 'rotate', layer: main, center, start: Math.atan2(p[1] - center[1], p[0] - center[0]) };
        return;
      }
      // The anchor point (Alt-drag moves it).
      if (e.altKey) {
        store.begin('Move anchor point');
        drag.current = { kind: 'anchor', layer: main, start: p };
        return;
      }
    }
    const hit = hitLayer(look, p);
    if (hit) {
      let selection = s.selection;
      if (e.shiftKey || e.ctrlKey || e.metaKey) selection = selection.includes(hit.id) ? selection.filter((x) => x !== hit.id) : [...selection, hit.id];
      else if (!selection.includes(hit.id)) selection = [hit.id];
      store.set({ selection, editingText: null });
      const orig = new Map<string, Layer>();
      for (const id of selection) {
        const l = findLayer(c, id);
        if (l && !l.locked) orig.set(id, l);
      }
      store.begin('Move');
      drag.current = { kind: 'move', start: p, orig, box: layerBounds(look, hit), axis: null };
      return;
    }
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) store.set({ selection: [], editingText: null });
    drag.current = { kind: 'marquee', start: p, now: p, add: e.shiftKey };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const s = store.get();
    const p = toComp(e);
    const c = compOf(s.project, s.compId);
    const t = s.time;
    switch (d.kind) {
      case 'pan':
        store.set({ pan: [d.pan[0] + e.clientX - d.start[0], d.pan[1] + e.clientY - d.start[1]] });
        return;
      case 'marquee':
      case 'draw':
        d.now = p;
        store.set({});
        return;
      case 'guide': {
        const guides = c.guides ?? { x: [], y: [] };
        const list = [...guides[d.axis]];
        list[d.index] = Math.round(d.axis === 'x' ? p[0] : p[1]);
        store.edit('Move guide', (pr) => updateComp(pr, c.id, (cc) => ({ ...cc, guides: { ...guides, [d.axis]: list } })));
        return;
      }
      case 'pen': {
        const v = [...pen.current];
        const last = v[v.length - 1];
        if (last && dist(p, d.at) * view.current.scale > 3) {
          const o: Vec2 = [p[0] - d.at[0], p[1] - d.at[1]];
          v[v.length - 1] = { p: last.p, o, i: [-o[0], -o[1]] };
          pen.current = v;
          store.set({});
        }
        return;
      }
      case 'move': {
        let dx = p[0] - d.start[0];
        let dy = p[1] - d.start[1];
        if (e.shiftKey) {
          d.axis ??= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (d.axis === 'x') dy = 0;
          else dx = 0;
        } else d.axis = null;
        snapLines.current = { x: [], y: [] };
        if (s.show.snap && d.box && !e.altKey) {
          const sn = snap(d.box, dx, dy, targets(s, [...d.orig.keys()]), SNAP_PX / view.current.scale);
          dx = sn.dx;
          dy = sn.dy;
          snapLines.current = sn.lines;
        }
        store.edit('Move', (pr) => {
          let next = pr;
          for (const [id, l] of d.orig) {
            const dd = toParent(c, l, t, [dx, dy]);
            const base = vec(l.transform.position, t, [0, 0]);
            next = updateLayers(next, c.id, [id], () => setAt(l, 'transform.position', [round(base[0] + dd[0]), round(base[1] + dd[1])], t));
          }
          return next;
        });
        return;
      }
      case 'anchor': {
        const l = d.layer;
        const m = worldMatrix(c, l, t, layerIndex(c), groupOf(c));
        const inv = invert(m);
        if (!inv) return;
        const a0 = vec(l.transform.anchor, t, [0, 0]);
        const la = apply(inv, p);
        const pos = vec(l.transform.position, t, [0, 0]);
        // Keep the picture still: the position moves with the anchor.
        const pa = apply(inv, d.start);
        const shiftLocal: Vec2 = [la[0] - pa[0], la[1] - pa[1]];
        const worldShift = [m[0] * shiftLocal[0] + m[2] * shiftLocal[1], m[1] * shiftLocal[0] + m[3] * shiftLocal[1]] as Vec2;
        const pd = toParent(c, l, t, worldShift);
        store.edit('Move anchor point', (pr) =>
          updateLayers(pr, c.id, [l.id], (x) =>
            setAt(
              setAt(x, 'transform.anchor', [round(a0[0] + shiftLocal[0]), round(a0[1] + shiftLocal[1])], t),
              'transform.position',
              [round(pos[0] + pd[0]), round(pos[1] + pd[1])],
              t,
            ),
          ),
        );
        return;
      }
      case 'rotate': {
        const a = Math.atan2(p[1] - d.center[1], p[0] - d.center[0]);
        let deg = num(d.layer.transform.rotation, t, 0);
        deg += ((a - d.start) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        store.edit('Rotate', (pr) => updateLayers(pr, c.id, [d.layer.id], (x) => setAt(x, 'transform.rotation', round(deg), t)));
        return;
      }
      case 'scale': {
        const l = d.layer;
        const m = worldMatrix(c, l, t, layerIndex(c), groupOf(c));
        const inv = invert([m[0], m[1], m[2], m[3], 0, 0]);
        if (!inv) return;
        const local = apply(inv, [p[0] - d.start[0], p[1] - d.start[1]]);
        const [hx, hy] = d.handle;
        const box = layerBox(lookOf(s), l);
        let dw = hx * local[0];
        let dh = hy * local[1];
        if (e.shiftKey && hx && hy && box.w && box.h) {
          const k = Math.max((box.w + dw) / box.w, (box.h + dh) / box.h);
          dw = box.w * k - box.w;
          dh = box.h * k - box.h;
        }
        const w = Math.max(1, box.w + dw);
        const h = Math.max(1, box.h + dh);
        // Dragging a left or top handle moves the layer so the other side stays.
        const shift: Vec2 = [hx < 0 ? box.w - w : 0, hy < 0 ? box.h - h : 0];
        const worldShift: Vec2 = [m[0] * shift[0] + m[2] * shift[1], m[1] * shift[0] + m[3] * shift[1]];
        const pd = toParent(c, l, t, worldShift);
        const pos = vec(l.transform.position, t, [0, 0]);
        store.edit('Resize', (pr) =>
          updateLayers(pr, c.id, [l.id], (x) => {
            let next = resized(x, w, h, box, t);
            if (shift[0] || shift[1]) next = setAt(next, 'transform.position', [round(pos[0] + pd[0]), round(pos[1] + pd[1])], t);
            return next;
          }),
        );
        return;
      }
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    snapLines.current = { x: [], y: [] };
    const s = store.get();
    const c = compOf(s.project, s.compId);
    if (!d) return;
    if (d.kind === 'marquee') {
      const box = boundsOf([d.start, d.now]);
      if (box.w > 2 || box.h > 2) {
        const look = lookOf(s);
        const ids = flatLayers(c.layers)
          .filter((l) => l.visible && !l.locked && l.type !== 'group' && s.time >= l.start && s.time < l.end)
          .filter((l) => {
            const b = layerBounds(look, l);
            return b && b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
          })
          .map((l) => l.id);
        store.set({ selection: d.add ? [...new Set([...s.selection, ...ids])] : ids });
      } else store.set({});
    } else if (d.kind === 'draw') {
      const b = boundsOf([d.start, d.now]);
      const big = b.w > 4 && b.h > 4;
      const size: Vec2 = big ? [Math.round(b.w), Math.round(b.h)] : [400, 120];
      const at: Vec2 = big ? [Math.round(b.x), Math.round(b.y)] : [Math.round(d.start[0]), Math.round(d.start[1])];
      const l = newShape(c, d.shape, at, size, '$box');
      l.end = c.duration;
      store.edit(d.shape === 'ellipse' ? 'Add ellipse' : 'Add rectangle', (pr) => addLayers(pr, c.id, [l], s.selection[0] ?? null), {
        selection: [l.id],
        tool: 'select',
      });
    } else if (d.kind === 'pen') {
      store.set({});
    } else if (d.kind === 'guide') {
      // A guide dragged back onto the ruler (or off the composition) goes away.
      const guides = c.guides;
      const v = guides?.[d.axis][d.index];
      if (guides && v !== undefined && (v < 0 || v > (d.axis === 'x' ? c.width : c.height))) {
        const list = guides[d.axis].filter((_, i) => i !== d.index);
        store.edit('Remove guide', (pr) => updateComp(pr, c.id, (cc) => ({ ...cc, guides: { ...guides, [d.axis]: list } })));
      }
      store.end();
    } else store.end();
  };

  const finishPen = (closed: boolean) => {
    const v = pen.current;
    pen.current = [];
    if (v.length < 2) {
      store.set({});
      return;
    }
    const s = store.get();
    const c = compOf(s.project, s.compId);
    const x0 = Math.min(...v.map((q) => q.p[0]));
    const y0 = Math.min(...v.map((q) => q.p[1]));
    const l = newShape(c, 'path', [Math.round(x0), Math.round(y0)], [0, 0], closed ? '$box' : '$accent');
    l.path = { closed, v: v.map((q) => ({ ...q, p: [round(q.p[0] - x0), round(q.p[1] - y0)] })) };
    if (!closed) {
      l.fill = null;
      l.stroke = { paint: { type: 'solid', color: '$accent' }, width: 6, cap: 'round', join: 'round' };
    }
    l.end = c.duration;
    store.edit('Draw path', (pr) => addLayers(pr, c.id, [l], s.selection[0] ?? null), { selection: [l.id] });
  };

  // The pen: Enter ends an open path, Escape drops it. Space held: the hand.
  const spaceDown = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
      if (typing) return;
      if (pen.current.length && e.key === 'Enter') {
        e.preventDefault();
        finishPen(false);
      } else if (pen.current.length && e.key === 'Escape') {
        pen.current = [];
        store.set({});
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const onWheel = (e: React.WheelEvent) => {
    const s = store.get();
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const v = view.current;
      const r = canvas.current!.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const next = Math.min(8, Math.max(0.05, v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      // Keep the point under the pointer still.
      const px = (mx - v.ox) / v.scale;
      const py = (my - v.oy) / v.scale;
      const c = compOf(s.project, s.compId);
      const left = s.show.rulers ? RULER : 0;
      const nox = mx - px * next;
      const noy = my - py * next;
      const cx = left + (size[0] - left - c.width * next) / 2;
      const cy = left + (size[1] - left - c.height * next) / 2;
      store.set({ zoom: next, pan: [nox - cx, noy - cy] });
    } else store.set({ pan: [s.pan[0] - e.deltaX, s.pan[1] - e.deltaY] });
  };

  const cursor = tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  return (
    <div className="tt-viewport" ref={wrap} data-testid="titler-viewport">
      <canvas
        ref={canvas}
        className="tt-canvas"
        style={{ width: size[0], height: size[1], cursor }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => {
          const s = store.get();
          const l = store.selected()[0];
          if (l?.type === 'text') store.set({ editingText: l.id });
          if (tool === 'pen' && pen.current.length > 1) finishPen(false);
          void s;
        }}
        onWheel={onWheel}
        onKeyDown={(e) => {
          if (e.key === ' ') spaceDown.current = true;
        }}
        onKeyUp={(e) => {
          if (e.key === ' ') spaceDown.current = false;
        }}
        tabIndex={0}
        aria-label="Composition canvas"
      />
    </div>
  );
}

/** The 8 handles (corners and edge middles) around four corners. */
function handlePoints(pts: Vec2[]): Vec2[] {
  if (pts.length < 4) return [];
  const [a, b, c, d] = pts as [Vec2, Vec2, Vec2, Vec2];
  const mid = (p: Vec2, q: Vec2): Vec2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  return [a, mid(a, b), b, mid(b, c), c, mid(c, d), d, mid(d, a)];
}
/** Which way each handle grows the box (x, y): -1 left/top, 1 right/bottom. */
const HANDLE_DIRS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

function inside(pts: Vec2[], p: Vec2): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (v: number) => Math.round(v * 10) / 10;

/** A layer made w × h: boxes and sizes change; groups, nulls and precomps are scaled. */
function resized(l: Layer, w: number, h: number, box: { w: number; h: number }, t: number): Layer {
  const W = round(w);
  const H = round(h);
  switch (l.type) {
    case 'text':
      return { ...l, box: [W, H] };
    case 'shape':
      if (l.shape === 'path' && l.path) {
        const kx = box.w ? w / box.w : 1;
        const ky = box.h ? h / box.h : 1;
        return {
          ...l,
          path: {
            ...l.path,
            v: l.path.v.map((v) => ({
              p: [round(v.p[0] * kx), round(v.p[1] * ky)],
              ...(v.i ? { i: [v.i[0] * kx, v.i[1] * ky] as Vec2 } : {}),
              ...(v.o ? { o: [v.o[0] * kx, v.o[1] * ky] as Vec2 } : {}),
            })),
          },
        };
      }
      if (l.fitTo) return l;
      return setAt(l, 'size', [W, H], t);
    case 'image':
    case 'video':
      return { ...l, size: [W, H] };
    default: {
      const s = vec(l.transform.scale, t, [100, 100]);
      return setAt(l, 'transform.scale', [round((s[0] * w) / Math.max(1, box.w)), round((s[1] * h) / Math.max(1, box.h))], t);
    }
  }
}

/** What a dragged box snaps to: the frame's edges and middle, the safe areas, guides, other layers. */
function targets(s: EditorState, moving: string[]): { x: number[]; y: number[] } {
  const c = compOf(s.project, s.compId);
  const x = [0, c.width / 2, c.width, c.width * 0.05, c.width * 0.95, c.width * 0.035, c.width * 0.965];
  const y = [0, c.height / 2, c.height, c.height * 0.05, c.height * 0.95, c.height * 0.035, c.height * 0.965];
  if (c.guides) {
    x.push(...c.guides.x);
    y.push(...c.guides.y);
  }
  const look = lookOf(s);
  for (const l of flatLayers(c.layers)) {
    if (moving.includes(l.id) || !l.visible || l.type === 'group' || s.time < l.start || s.time >= l.end) continue;
    const b = layerBounds(look, l);
    if (!b) continue;
    x.push(b.x, b.x + b.w / 2, b.x + b.w);
    y.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { x, y };
}

function snap(box: Box, dx: number, dy: number, t: { x: number[]; y: number[] }, within: number) {
  const lines = { x: [] as number[], y: [] as number[] };
  const best = (edges: number[], list: number[]) => {
    let d = Infinity;
    let at = 0;
    for (const e of edges)
      for (const g of list) {
        const k = g - e;
        if (Math.abs(k) < Math.abs(d)) {
          d = k;
          at = g;
        }
      }
    return { d, at };
  };
  const bx = best([box.x + dx, box.x + box.w / 2 + dx, box.x + box.w + dx], t.x);
  if (Math.abs(bx.d) <= within) {
    dx += bx.d;
    lines.x.push(bx.at);
  }
  const by = best([box.y + dy, box.y + box.h / 2 + dy, box.y + box.h + dy], t.y);
  if (Math.abs(by.d) <= within) {
    dy += by.d;
    lines.y.push(by.at);
  }
  return { dx, dy, lines };
}

function drawRulers(ctx: CanvasRenderingContext2D, W: number, H: number, scale: number, ox: number, oy: number, col: (n: string, d: string) => string) {
  ctx.fillStyle = col('--tt-bar', '#181817');
  ctx.fillRect(0, 0, W, RULER);
  ctx.fillRect(0, 0, RULER, H);
  ctx.strokeStyle = col('--tt-line', '#2d2d2b');
  ctx.beginPath();
  ctx.moveTo(0, RULER + 0.5);
  ctx.lineTo(W, RULER + 0.5);
  ctx.moveTo(RULER + 0.5, 0);
  ctx.lineTo(RULER + 0.5, H);
  ctx.stroke();
  const step = [10, 20, 50, 100, 200, 500, 1000].find((s) => s * scale >= 50) ?? 1000;
  ctx.fillStyle = col('--tt-faint', '#75756f');
  ctx.strokeStyle = col('--tt-line-2', '#3a3a37');
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.beginPath();
  for (let v = Math.floor(-ox / scale / step) * step; ox + v * scale < W; v += step) {
    const x = Math.round(ox + v * scale) + 0.5;
    if (x < RULER) continue;
    ctx.moveTo(x, RULER - 6);
    ctx.lineTo(x, RULER);
    ctx.fillText(String(v), x + 2, 3);
  }
  for (let v = Math.floor(-oy / scale / step) * step; oy + v * scale < H; v += step) {
    const y = Math.round(oy + v * scale) + 0.5;
    if (y < RULER) continue;
    ctx.moveTo(RULER - 6, y);
    ctx.lineTo(RULER, y);
    ctx.save();
    ctx.translate(3, y + 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(String(v), 0, -10);
    ctx.restore();
  }
  ctx.stroke();
  ctx.fillStyle = col('--tt-bar', '#181817');
  ctx.fillRect(0, 0, RULER, RULER);
}
