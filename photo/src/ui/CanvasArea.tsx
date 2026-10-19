// The canvas: the WebGL view of the current document, the overlay the tools
// draw on (handles, outlines, the brush circle), rulers, guides and the grid,
// and the pointer, pen and wheel input that goes to the tools.

import { useEffect, useRef, useState } from 'react';
import { app, current, onFrameRequest, requestFrame, useApp, useSession, bump } from '../app/state';
import { View } from '../gpu/view';
import { setView } from '../app/ops/common';
import { toolFor } from '../app/tools';
import { viewport, toDoc, type Tool, type ToolEvent, type Overlay } from '../app/tools/types';
import { handTool, zoomStep, pan, zoomBy } from '../app/tools/viewTools';
import { docToScreenMatrix, apply, fitView } from '../app/viewMath';
import { findLayer } from '../core/layers';
import { drawSamplers } from '../app/tools/miscTools';
import { isMac } from '../app/commands';
import { uid } from '../core/layers';
import type { Session } from '../app/session';
import type { Guide } from '../core/types';

/** Keys held right now (Space for the hand). */
export const held = { space: false, alt: false, ctrl: false, shift: false };

/** Draw again at the next animation frame. */
let scheduled = false;
let drawFn: (() => void) | null = null;
function schedule(): void {
  if (scheduled || !drawFn) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    drawFn?.();
  });
}

function cssVar(name: string, el: Element): [number, number, number] {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) return [0.07, 0.07, 0.07];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const CHECKER: Record<string, number> = { small: 4, medium: 8, large: 16 };

function needsAnimation(s: Session, tool: Tool | null): boolean {
  return !!s.doc.selection || !!tool?.active?.();
}

export function CanvasArea() {
  const wrap = useRef<HTMLDivElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const ovCanvas = useRef<HTMLCanvasElement>(null);
  const rulerX = useRef<HTMLCanvasElement>(null);
  const rulerY = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const showRulers = useApp((s) => s.showRulers);
  const session = useSession();
  const theme = useApp((s) => s.theme);
  const hover = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const viewRef = useRef<View | null>(null);
  const dragGuide = useRef<{ guide: Guide; before: Guide[] } | null>(null);

  // The GL view, once.
  useEffect(() => {
    try {
      const v = new View(glCanvas.current!);
      viewRef.current = v;
      setView(v);
      glCanvas.current!.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        setError('The graphics card stopped drawing. Save your work and reopen Lumora Photo.');
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => setView(null);
  }, []);

  // Size: device pixels for the GL canvas and the overlay.
  useEffect(() => {
    const el = wrap.current!;
    viewport.el = el;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      viewport.w = r.width;
      viewport.h = r.height;
      for (const c of [glCanvas.current!, ovCanvas.current!]) {
        c.width = Math.max(1, Math.round(r.width * dpr));
        c.height = Math.max(1, Math.round(r.height * dpr));
      }
      for (const s of app.get().sessions) if (s.fitted) s.view = { ...fitView(s.doc.width, s.doc.height, r.width, r.height), rotation: s.view.rotation };
      drawFn?.();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new document starts fitted to the window.
  useEffect(() => {
    if (session && session.fitted && viewport.w > 10) {
      session.view = { ...fitView(session.doc.width, session.doc.height, viewport.w, viewport.h), rotation: session.view.rotation };
      requestFrame();
    }
  }, [session]);

  // Drawing.
  useEffect(() => {
    let anim = 0;
    drawFn = () => {
      const s = current();
      const st = app.get();
      const view = viewRef.current;
      const ov = ovCanvas.current;
      const el = wrap.current;
      if (!ov || !el) return;
      const dpr = window.devicePixelRatio || 1;
      const ctx = ov.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ov.width, ov.height);
      const tool = toolFor(st.tool);
      if (!s) {
        if (view) {
          const gl = view.gpu.gl;
          const c = cssVar('--work', el);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, glCanvas.current!.width, glCanvas.current!.height);
          gl.clearColor(c[0], c[1], c[2], 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        return;
      }
      const time = performance.now() / 1000;
      if (view) {
        const t0 = performance.now();
        const light = st.theme === 'light';
        const showMask = (() => {
          if (!s.showMask) return null;
          const l = findLayer(s.doc.layers, s.showMask);
          if (l?.mask) return { raster: l.mask.raster, bg: l.mask.background };
          const ch = s.doc.channels.find((c) => c.id === s.showMask);
          return ch ? { raster: ch.raster, bg: 0 } : null;
        })();
        try {
          view.draw(
            s,
            {
              pasteboard: cssVar('--work', el),
              check1: light ? [1, 1, 1] : [0.8, 0.8, 0.8],
              check2: light ? [0.86, 0.86, 0.86] : [0.6, 0.6, 0.6],
              pixelGrid: st.pixelGrid && st.showExtras,
              time,
              quickColor: [1, 0, 0, 0.5],
              displayP3: st.prefs.displayP3,
              exposure: 0,
            },
            showMask,
          );
        } catch (e) {
          console.error(e);
        }
        if (s.compositor) s.compositor.lastMs = performance.now() - t0;
      }
      // Overlay (CSS pixels).
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const m = docToScreenMatrix(s.view, s.doc.width, s.doc.height);
      const toScreen = (x: number, y: number) => apply(m, x, y);
      const o: Overlay = { ctx, s, toScreen, zoom: s.view.zoom, time };
      if (st.showExtras) {
        if (st.showGrid) drawGrid(o, st.prefs.gridSpacing, st.prefs.gridSubdivisions);
        drawBoards(o);
        if (st.showGuides) drawGuides(o, st.prefs.guideColor);
      }
      tool?.overlay?.(o);
      if (st.tool !== 'colorSampler') drawSamplers(o);
      // The brush circle.
      const h = hover.current;
      if (h && tool?.brushSize && !held.space) {
        const r = Math.max(1, (tool.brushSize() * s.view.zoom) / 2);
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.beginPath();
        ctx.arc(h.sx, h.sy, r + 0.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(h.sx, h.sy, r - 0.5 > 0 ? r - 0.5 : r, 0, Math.PI * 2);
        ctx.stroke();
        if (st.prefs.showBrushCrosshair || r < 4) {
          ctx.beginPath();
          ctx.moveTo(h.sx - 4, h.sy);
          ctx.lineTo(h.sx + 4, h.sy);
          ctx.moveTo(h.sx, h.sy - 4);
          ctx.lineTo(h.sx, h.sy + 4);
          ctx.stroke();
        }
        ctx.restore();
      }
      drawRulers(s);
      if (needsAnimation(s, tool)) {
        cancelAnimationFrame(anim);
        anim = requestAnimationFrame(() => schedule());
      }
    };
    const off = onFrameRequest(schedule);
    schedule();
    return () => {
      off();
      cancelAnimationFrame(anim);
      drawFn = null;
    };
  }, []);

  useEffect(() => {
    schedule();
  }, [theme, showRulers, session]);

  function drawRulers(s: Session) {
    const st = app.get();
    if (!st.showRulers) return;
    const dpr = window.devicePixelRatio || 1;
    const m = docToScreenMatrix({ ...s.view, rotation: 0, flip: false }, s.doc.width, s.doc.height);
    const el = wrap.current!;
    const bg = getComputedStyle(el).getPropertyValue('--panel').trim() || '#262625';
    const fgc = getComputedStyle(el).getPropertyValue('--faint').trim() || '#888';
    const line = getComputedStyle(el).getPropertyValue('--line').trim() || '#333';
    for (const axis of ['x', 'y'] as const) {
      const c = axis === 'x' ? rulerX.current : rulerY.current;
      if (!c) continue;
      const len = axis === 'x' ? viewport.w : viewport.h;
      const W = axis === 'x' ? len : 18,
        H = axis === 'x' ? 18 : len;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        c.style.width = `${W}px`;
        c.style.height = `${H}px`;
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = line;
      ctx.beginPath();
      if (axis === 'x') {
        ctx.moveTo(0, H - 0.5);
        ctx.lineTo(W, H - 0.5);
      } else {
        ctx.moveTo(W - 0.5, 0);
        ctx.lineTo(W - 0.5, H);
      }
      ctx.stroke();
      const z = s.view.zoom;
      const origin = axis === 'x' ? m[4] : m[5];
      // Pick a step that leaves ~60 px between labels.
      const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
      const step = steps.find((v) => v * z >= 60) ?? 10000;
      const minor = step / (String(step).startsWith('25') ? 5 : step % 5 === 0 && step >= 5 ? 5 : 2);
      const d0 = Math.floor(-origin / z / minor) * minor,
        d1 = (len - origin) / z;
      ctx.fillStyle = fgc;
      ctx.strokeStyle = fgc;
      ctx.font = '9.5px Inter Variable, system-ui, sans-serif';
      ctx.beginPath();
      for (let d = d0; d <= d1; d += minor) {
        const p = Math.round(origin + d * z) + 0.5;
        const major = Math.abs(d / step - Math.round(d / step)) < 1e-6;
        const t = major ? 18 : 5;
        if (axis === 'x') {
          ctx.moveTo(p, H);
          ctx.lineTo(p, H - t);
          if (major) ctx.fillText(String(Math.round(d)), p + 2, 9);
        } else {
          ctx.moveTo(W, p);
          ctx.lineTo(W - t, p);
          if (major) {
            ctx.save();
            ctx.translate(9, p + 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(Math.round(d)), 0, 0);
            ctx.restore();
          }
        }
      }
      ctx.stroke();
      // The pointer's position.
      const h = hover.current;
      if (h) {
        ctx.strokeStyle = getComputedStyle(el).getPropertyValue('--text').trim() || '#fff';
        ctx.beginPath();
        if (axis === 'x') {
          ctx.moveTo(Math.round(h.sx) + 0.5, 0);
          ctx.lineTo(Math.round(h.sx) + 0.5, H);
        } else {
          ctx.moveTo(0, Math.round(h.sy) + 0.5);
          ctx.lineTo(W, Math.round(h.sy) + 0.5);
        }
        ctx.stroke();
      }
    }
  }

  // ---- input ----

  const toolEvent = (e: React.PointerEvent | PointerEvent, s: Session): ToolEvent => {
    const r = wrap.current!.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    const [x, y] = toDoc(sx, sy, s);
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 1;
    return {
      x,
      y,
      sx,
      sy,
      pressure,
      button: e.button,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: isMac ? e.metaKey : e.ctrlKey,
      pointerType: e.pointerType,
      detail: (e as PointerEvent).detail ?? 1,
    };
  };

  const active = useRef<{ tool: Tool; id: number } | null>(null);

  const guideAt = (s: Session, sx: number, sy: number): Guide | null => {
    if (!app.get().showGuides || !app.get().showExtras) return null;
    const m = docToScreenMatrix(s.view, s.doc.width, s.doc.height);
    for (const g of s.doc.guides) {
      const p = g.axis === 'x' ? apply(m, g.at, 0)[0] : apply(m, 0, g.at)[1];
      if (Math.abs((g.axis === 'x' ? sx : sy) - p) <= 3) return g;
    }
    return null;
  };

  const pickTool = (e: React.PointerEvent): Tool | null => {
    if (e.button === 1 || held.space) return handTool;
    return toolFor(app.get().tool);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = current();
    if (!s) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    wrap.current!.focus();
    const ev = toolEvent(e, s);
    // Guides: drag them with the Move tool (or any tool with Ctrl).
    if (e.button === 0 && (app.get().tool === 'move' || ev.ctrl)) {
      const g = guideAt(s, ev.sx, ev.sy);
      if (g) {
        dragGuide.current = { guide: g, before: s.doc.guides };
        wrap.current!.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (e.button === 2) return;
    const t = pickTool(e);
    if (!t) return;
    wrap.current!.setPointerCapture(e.pointerId);
    active.current = { tool: t, id: e.pointerId };
    try {
      t.down?.(ev);
    } catch (err) {
      console.error(err);
    }
    schedule();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = current();
    if (!s) return;
    const ev = toolEvent(e, s);
    hover.current = { sx: ev.sx, sy: ev.sy, x: ev.x, y: ev.y };
    pointerInfo.x = ev.x;
    pointerInfo.y = ev.y;
    pointerInfo.inside = true;
    for (const f of pointerListeners) f();
    if (dragGuide.current) {
      const g = dragGuide.current.guide;
      const at = Math.round(g.axis === 'x' ? ev.x : ev.y);
      s.doc = { ...s.doc, guides: s.doc.guides.map((x) => (x.id === g.id ? { ...x, at } : x)) };
      dragGuide.current.guide = { ...g, at };
      schedule();
      return;
    }
    const a = active.current;
    if (a) {
      const native = e.nativeEvent;
      const list = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
      if (list.length > 1) for (const ce of list) a.tool.move?.(toolEvent(ce, s));
      else a.tool.move?.(ev);
    } else {
      const t = held.space ? handTool : toolFor(app.get().tool);
      t?.hover?.(ev);
      const g = (app.get().tool === 'move' || ev.ctrl) && guideAt(s, ev.sx, ev.sy);
      wrap.current!.style.cursor = g ? (g.axis === 'x' ? 'col-resize' : 'row-resize') : (t?.cursor?.(ev) ?? 'default');
    }
    schedule();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = current();
    if (!s) return;
    if (dragGuide.current) {
      const { guide, before } = dragGuide.current;
      dragGuide.current = null;
      const r = wrap.current!.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientY < r.top || e.clientX > r.right || e.clientY > r.bottom;
      const others = before.filter((x) => x.id !== guide.id);
      s.doc = { ...s.doc, guides: before };
      s.commit(outside ? 'Delete Guide' : 'Move Guide', 'guide', { ...s.doc, guides: outside ? others : [...others, guide] });
      bump();
      return;
    }
    const a = active.current;
    if (!a) return;
    active.current = null;
    try {
      void a.tool.up?.(toolEvent(e, s));
    } catch (err) {
      console.error(err);
    }
    schedule();
  };

  // New guides: drag out of a ruler.
  const rulerDown = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    const s = current();
    if (!s) return;
    e.preventDefault();
    const g: Guide = { id: uid('g'), axis, at: -1e6 };
    const before = s.doc.guides;
    const move = (ev: PointerEvent) => {
      const r = wrap.current!.getBoundingClientRect();
      const [x, y] = toDoc(ev.clientX - r.left, ev.clientY - r.top, s);
      g.at = Math.round(axis === 'x' ? x : y);
      s.doc = { ...s.doc, guides: [...before, { ...g }] };
      schedule();
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const r = wrap.current!.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientY >= r.top && ev.clientX <= r.right && ev.clientY <= r.bottom;
      s.doc = { ...s.doc, guides: before };
      if (inside && g.at > -1e5) s.commit('New Guide', 'guide', { ...s.doc, guides: [...before, { ...g }] });
      bump();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onWheel = (e: WheelEvent) => {
    const s = current();
    if (!s) return;
    e.preventDefault();
    const r = wrap.current!.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    const zoomWheel = app.get().prefs.zoomWithWheel;
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    // Pinch on a trackpad arrives as Ctrl+wheel.
    if (e.altKey || (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 && !Number.isInteger(e.deltaY)) || (zoomWheel && !ctrl && !e.shiftKey)) {
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      zoomBy(f, sx, sy);
      return;
    }
    if (ctrl) {
      pan(-e.deltaY, 0);
      return;
    }
    const k = e.deltaMode === 1 ? 20 : 1;
    if (e.shiftKey) pan(-e.deltaY * k, 0);
    else pan(-e.deltaX * k, -e.deltaY * k);
  };

  useEffect(() => {
    const el = wrap.current!;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className={`lp-stage${showRulers ? ' lp-rulers' : ''}`}>
      <div className="lp-corner" />
      <div className="lp-ruler" onPointerDown={rulerDown('y')} title="Drag a guide from the ruler">
        {showRulers && <canvas ref={rulerX} />}
      </div>
      <div className="lp-ruler" onPointerDown={rulerDown('x')} title="Drag a guide from the ruler">
        {showRulers && <canvas ref={rulerY} />}
      </div>
      <div
        ref={wrap}
        className="lp-canvas-wrap"
        tabIndex={-1}
        aria-label="Canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          hover.current = null;
          pointerInfo.inside = false;
          for (const f of pointerListeners) f();
          schedule();
        }}
        onDoubleClick={(e) => {
          if (!current() && e.target === e.currentTarget) void import('../app/files').then((m) => m.openDialog());
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={glCanvas} />
        <canvas ref={ovCanvas} style={{ pointerEvents: 'none' }} />
        {error && (
          <div className="lp-empty" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/** Where the pointer is over the document (Info panel, status bar). */
export const pointerInfo = { x: 0, y: 0, inside: false };
const pointerListeners = new Set<() => void>();
export function onPointerInfo(f: () => void): () => void {
  pointerListeners.add(f);
  return () => {
    pointerListeners.delete(f);
  };
}

function drawGrid(o: Overlay, spacing: number, subdivisions: number): void {
  const { ctx, s, toScreen } = o;
  const sub = spacing / Math.max(1, subdivisions);
  if (sub * o.zoom < 4) return;
  ctx.save();
  ctx.lineWidth = 1;
  for (const [step, alpha] of [
    [sub, 0.12],
    [spacing, 0.3],
  ] as const) {
    ctx.strokeStyle = `rgba(128,128,128,${alpha})`;
    ctx.beginPath();
    for (let x = 0; x <= s.doc.width; x += step) {
      const [a, b] = toScreen(x, 0),
        [c, d] = toScreen(x, s.doc.height);
      ctx.moveTo(Math.round(a) + 0.5, b);
      ctx.lineTo(Math.round(c) + 0.5, d);
    }
    for (let y = 0; y <= s.doc.height; y += step) {
      const [a, b] = toScreen(0, y),
        [c, d] = toScreen(s.doc.width, y);
      ctx.moveTo(a, Math.round(b) + 0.5);
      ctx.lineTo(c, Math.round(d) + 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawGuides(o: Overlay, color: string): void {
  const { ctx, s, toScreen } = o;
  if (!s.doc.guides.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const far = 1e5;
  for (const g of s.doc.guides) {
    const [a, b] = g.axis === 'x' ? toScreen(g.at, -far) : toScreen(-far, g.at);
    const [c, d] = g.axis === 'x' ? toScreen(g.at, far) : toScreen(far, g.at);
    if (g.axis === 'x') {
      ctx.moveTo(Math.round(a) + 0.5, b);
      ctx.lineTo(Math.round(c) + 0.5, d);
    } else {
      ctx.moveTo(a, Math.round(b) + 0.5);
      ctx.lineTo(c, Math.round(d) + 0.5);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawBoards(o: Overlay): void {
  const { ctx, s, toScreen } = o;
  ctx.save();
  ctx.font = '11px Inter Variable, system-ui, sans-serif';
  for (const a of s.doc.artboards) {
    const [x, y] = toScreen(a.rect.x, a.rect.y);
    const [x2, y2] = toScreen(a.rect.x + a.rect.w, a.rect.y + a.rect.h);
    ctx.strokeStyle = 'rgba(160,160,160,0.8)';
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(x2 - x), Math.round(y2 - y));
    ctx.fillStyle = 'rgba(200,200,200,0.9)';
    ctx.fillText(a.name, x, y - 5);
  }
  for (const sl of s.doc.slices) {
    const [x, y] = toScreen(sl.rect.x, sl.rect.y);
    const [x2, y2] = toScreen(sl.rect.x + sl.rect.w, sl.rect.y + sl.rect.h);
    ctx.strokeStyle = 'rgba(80,140,220,0.9)';
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(x2 - x), Math.round(y2 - y));
    ctx.fillStyle = 'rgba(80,140,220,0.95)';
    ctx.fillRect(x, y, Math.max(22, ctx.measureText(sl.name).width + 8), 15);
    ctx.fillStyle = '#fff';
    ctx.fillText(sl.name, x + 4, y + 11);
  }
  ctx.restore();
}

export { zoomStep };
