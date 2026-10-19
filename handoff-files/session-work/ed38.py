import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Viewport.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''  | { kind: 'anchor'; layer: Layer; start: Vec2 };''','''  | { kind: 'anchor'; layer: Layer; start: Vec2 }
  /** An outline's point, one of its handles, or the whole outline (a mask) dragged. */
  | { kind: 'outline'; layer: Layer; ref: OutlineRef; outlines: PathData[]; outline: number; vertex: number; part: 'p' | 'i' | 'o' | 'all'; start: Vec2; free: boolean };''')
rep('''import type { CanvasNote, Layer, PathVertex, Vec2 } from '../core/types';''','''import type { CanvasNote, Layer, PathData, PathVertex, Vec2 } from '../core/types';
import { moveOutline, moveTangent, moveVertex, outlineRefs, outlinesAt, sameRef, setOutlinesAt, type OutlineRef } from './outlines';
import { viewOfLayer } from '../core/render';''')
# drawing
rep('''    const main = sel[0];
    if (main && sel.length === 1 && main.type !== 'group' && !main.locked) {
      const pts = layerCorners(look, main).map(P);
      ctx.fillStyle = col('--tt-panel', '#1c1c1b');
      for (const h of handlePoints(pts)) {''','''    const main = sel[0];
    if (main && sel.length === 1 && main.type !== 'group' && !main.locked) {
      const pts = layerCorners(look, main).map(P);
      ctx.fillStyle = col('--tt-panel', '#1c1c1b');
      // Its masks' outlines (and its own path's while its points are edited), with their points.
      for (const o of screenOutlines(s, main, t, P)) {
        ctx.save();
        ctx.strokeStyle = o.ref.kind === 'mask' ? MASK_COLOR : col('--tt-select', '#e9e9e6');
        ctx.lineWidth = 1;
        ctx.beginPath();
        o.segs.forEach((g, i) => {
          if (!i) ctx.moveTo(g.a[0], g.a[1]);
          ctx.bezierCurveTo(g.c1[0], g.c1[1], g.c2[0], g.c2[1], g.b[0], g.b[1]);
        });
        ctx.stroke();
        const chosen = s.outlinePoint && sameRef(s.outlinePoint.ref, o.ref) && s.outlinePoint.outline === o.outline ? s.outlinePoint.vertex : -1;
        o.points.forEach((q, i) => {
          if (i === chosen) {
            // Its handles.
            for (const h of [q.i, q.o]) {
              if (!h) continue;
              ctx.beginPath();
              ctx.moveTo(q.p[0], q.p[1]);
              ctx.lineTo(h[0], h[1]);
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(h[0], h[1], 3.5, 0, Math.PI * 2);
              ctx.fillStyle = ctx.strokeStyle as string;
              ctx.fill();
            }
          }
          ctx.fillStyle = i === chosen ? (ctx.strokeStyle as string) : col('--tt-panel', '#1c1c1b');
          ctx.fillRect(q.p[0] - 3.5, q.p[1] - 3.5, 7, 7);
          ctx.strokeRect(q.p[0] - 3.5 + 0.5, q.p[1] - 3.5 + 0.5, 6, 6);
        });
        ctx.restore();
      }
      ctx.fillStyle = col('--tt-panel', '#1c1c1b');
      for (const h of s.editingPath === main.id ? [] : handlePoints(pts)) {''')
# hit testing in onDown before handle checks
rep('''    const sel = store.selected();
    const main = sel[0];
    if (main && sel.length === 1 && main.type !== 'group' && !main.locked) {
      const pts = layerCorners(look, main);''','''    const sel = store.selected();
    const main = sel[0];
    // An outline's point or handle (a mask's, or a path's while its points are edited), or a mask's line.
    if (main && sel.length === 1 && !main.locked) {
      const v = view.current;
      const Pv = (q: Vec2): Vec2 => [v.ox + q[0] * v.scale, v.oy + q[1] * v.scale];
      const at = Pv(p);
      const list = screenOutlines(s, main, s.time, Pv);
      const near = (q: Vec2 | undefined, r: number) => !!q && dist(q, at) <= r;
      const begin = (o: (typeof list)[number], vertex: number, part: 'p' | 'i' | 'o' | 'all') => {
        e.preventDefault();
        store.begin('Edit outline');
        store.set({ outlinePoint: part === 'all' ? s.outlinePoint : { ref: o.ref, outline: o.outline, vertex } });
        drag.current = { kind: 'outline', layer: main, ref: o.ref, outlines: outlinesAt(main, o.ref, s.time), outline: o.outline, vertex, part, start: p, free: e.altKey };
      };
      const cur = s.outlinePoint;
      for (const o of list) {
        if (cur && sameRef(cur.ref, o.ref) && cur.outline === o.outline) {
          const q = o.points[cur.vertex];
          if (q && near(q.o, 6)) return begin(o, cur.vertex, 'o');
          if (q && near(q.i, 6)) return begin(o, cur.vertex, 'i');
        }
      }
      for (const o of list) {
        const i = o.points.findIndex((q) => near(q.p, 6));
        // Alt-drag on a point pulls out its handles (a corner made round).
        if (i >= 0) return begin(o, i, e.altKey ? 'o' : 'p');
      }
      for (const o of list) if (o.ref.kind === 'mask' && o.segs.some((g) => nearSeg(g, at, 5))) return begin(o, -1, 'all');
      if (s.editingPath === main.id) {
        // Editing a path's points: a click away ends it.
        store.set({ editingPath: null, outlinePoint: null });
      }
    }
    if (main && sel.length === 1 && main.type !== 'group' && !main.locked && s.editingPath !== main.id) {
      const pts = layerCorners(look, main);''')
# drag move
rep('''    switch (d.kind) {
      case 'pan':''','''    switch (d.kind) {
      case 'outline': {
        const l = d.layer;
        const m = worldMatrix(c, l, t, layerIndex(c), groupOf(c));
        const inv = invert(m);
        if (!inv) return;
        const q = apply(inv, p);
        const q0 = apply(inv, d.start);
        const o = d.outlines[d.outline];
        if (!o) return;
        let next: PathData = o;
        if (d.part === 'all') next = moveOutline(o, [q[0] - q0[0], q[1] - q0[1]]);
        else if (d.part === 'p') {
          const v0 = o.v[d.vertex]!.p;
          next = moveVertex(o, d.vertex, [v0[0] + q[0] - q0[0], v0[1] + q[1] - q0[1]]);
        } else {
          const v0 = o.v[d.vertex]!.p;
          next = moveTangent(o, d.vertex, d.part, [q[0] - v0[0], q[1] - v0[1]], d.free || e.altKey);
        }
        const outlines = d.outlines.map((x, i) => (i === d.outline ? next : x));
        store.edit('Edit outline', (pr) => updateLayers(pr, c.id, [l.id], (x) => setOutlinesAt(x, d.ref, t, outlines)));
        return;
      }
      case 'pan':''')
# double click: path shapes enter point editing
rep('''          const l = hit?.type === 'text' ? hit : store.selected()[0];
          if (l?.type === 'text' && !l.locked) store.set({ selection: [l.id], editingText: l.id, tool: 'select' });''','''          const l = hit?.type === 'text' || (hit?.type === 'shape' && hit.shape === 'path') ? hit : store.selected()[0];
          if (l?.type === 'text' && !l.locked) store.set({ selection: [l.id], editingText: l.id, tool: 'select' });
          // A path shape: its points (and their handles) are edited on the canvas.
          else if (l?.type === 'shape' && l.shape === 'path' && !l.locked)
            store.set({ selection: [l.id], editingPath: l.id, outlinePoint: null, tool: 'select', status: 'Drag the points and their handles; Alt-drag a point to round it. Esc or a click away when done.' });''')
# empty click clears editing path
rep('''    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) store.set({ selection: [], editingText: null });''','''    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) store.set({ selection: [], editingText: null, editingPath: null, outlinePoint: null });''')
rep('''/**
 * Space: a tap plays or pauses;''','''const MASK_COLOR = '#d9b34c';

interface ScreenOutline {
  ref: OutlineRef;
  outline: number;
  segs: { a: Vec2; c1: Vec2; c2: Vec2; b: Vec2 }[];
  points: { p: Vec2; i?: Vec2; o?: Vec2 }[];
}

/** A layer's editable outlines on the screen: its masks, and its own path while its points are edited. */
function screenOutlines(s: EditorState, l: Layer, t: number, P: (p: Vec2) => Vec2): ScreenOutline[] {
  const refs = outlineRefs(l).filter((r) => r.kind === 'mask' || s.editingPath === l.id);
  if (!refs.length) return [];
  const c = compOf(s.project, s.compId);
  const m = worldMatrix(c, l, t, layerIndex(c), groupOf(c));
  const seen = viewOfLayer(c, l, t);
  const S = (q: Vec2): Vec2 => {
    const w = apply(m, q);
    return P(seen ? seen(w) : w);
  };
  const out: ScreenOutline[] = [];
  for (const ref of refs)
    outlinesAt(l, ref, t).forEach((o, outline) => {
      const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
      const n = o.v.length;
      const segs: ScreenOutline['segs'] = [];
      for (let i = 0; i < (o.closed ? n : n - 1); i++) {
        const a = o.v[i]!;
        const b = o.v[(i + 1) % n]!;
        segs.push({ a: S(a.p), c1: S(add(a.p, a.o ?? [0, 0])), c2: S(add(b.p, b.i ?? [0, 0])), b: S(b.p) });
      }
      const points = o.v.map((v) => ({
        p: S(v.p),
        ...(v.i && (v.i[0] || v.i[1]) ? { i: S(add(v.p, v.i)) } : {}),
        ...(v.o && (v.o[0] || v.o[1]) ? { o: S(add(v.p, v.o)) } : {}),
      }));
      out.push({ ref, outline, segs, points });
    });
  return out;
}

/** Is a point within `r` px of a curve (checked along it)? */
function nearSeg(g: ScreenOutline['segs'][number], p: Vec2, r: number): boolean {
  for (let k = 0; k <= 16; k++) {
    const u = k / 16;
    const w = 1 - u;
    const x = w * w * w * g.a[0] + 3 * w * w * u * g.c1[0] + 3 * w * u * u * g.c2[0] + u * u * u * g.b[0];
    const y = w * w * w * g.a[1] + 3 * w * w * u * g.c1[1] + 3 * w * u * u * g.c2[1] + u * u * u * g.b[1];
    if (Math.hypot(x - p[0], y - p[1]) <= r) return true;
  }
  return false;
}

/**
 * Space: a tap plays or pauses;''')
open(p,'w').write(s)

p='Designer.tsx'; s=open(p).read()
rep('''        case 'Escape':
          store.set({ selection: [], keys: [], tool: 'select' });
          return;''','''        case 'Escape':
          // Editing a path's points: Escape ends that first.
          if (s.editingPath) return store.set({ editingPath: null, outlinePoint: null, status: '' });
          store.set({ selection: [], keys: [], tool: 'select', outlinePoint: null });
          return;''')
open(p,'w').write(s)
