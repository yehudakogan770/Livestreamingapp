// The Patch tool: draw around a flaw (or use the selection), then drag the
// outline onto clean pixels: they're copied in and blended into the
// surroundings' color and light. With Destination, the selected pixels are
// copied to where you drag instead.

import { app, current, requestFrame, bump, toast } from '../state';
import { selectionMask, canvasRect } from '../ops/common';
import { applySelection } from '../ops/select';
import { healWithSource } from '../ops/heal';
import { fillPolygons, maskOutline, simplify, transformMask, maskBounds } from '../../core/selection';
import { intersect } from '../../core/raster';
import { updateLayer } from '../../core/layers';
import type { Layer } from '../../core/types';
import { paintTarget } from './paintTools';
import { drawPolyline } from './selectTools';
import type { Tool } from './types';

let lasso: number[] | null = null;
let drag: { x0: number; y0: number; dx: number; dy: number; outline: number[][] } | null = null;

function inSelection(x: number, y: number): boolean {
  const s = current();
  const sel = s?.doc.selection;
  return !!sel && (sel.mask.pixel(Math.floor(x), Math.floor(y))[0] ?? 0) > 0.5;
}

export const patchTool: Tool = {
  id: 'patch',
  cursor: (e) => (e && inSelection(e.x, e.y) ? 'move' : 'crosshair'),
  down: (e) => {
    const s = current();
    if (!s) return;
    if (inSelection(e.x, e.y)) {
      const m = selectionMask(s.doc)!;
      drag = { x0: e.x, y0: e.y, dx: 0, dy: 0, outline: maskOutline(m, 1).map((p) => simplify(p, 0.7)) };
      return;
    }
    lasso = [e.x, e.y];
  },
  move: (e) => {
    if (drag) {
      drag.dx = Math.round(e.x - drag.x0);
      drag.dy = Math.round(e.y - drag.y0);
      requestFrame();
      return;
    }
    if (!lasso) return;
    lasso.push(e.x, e.y);
    requestFrame();
  },
  up: () => {
    const s = current();
    if (!s) return;
    if (lasso) {
      const pts = lasso;
      lasso = null;
      if (pts.length >= 6) applySelection(fillPolygons(s.doc.width, s.doc.height, [pts], true), 'replace', 'Patch Selection');
      return;
    }
    const d = drag;
    drag = null;
    if (!d || (!d.dx && !d.dy)) {
      requestFrame();
      return;
    }
    const t = paintTarget();
    const sel = selectionMask(s.doc);
    if (!t || t.channels !== 4 || !sel) return;
    const src = app.get().opts.patch.source;
    // Source mode: the selected area takes the pixels from where it was dragged to.
    const hole = src ? sel : transformMask(sel, [1, 0, 0, 1, d.dx, d.dy]);
    const hb = maskBounds(hole);
    if (!hb) return;
    const pad = 6;
    const reg = intersect({ x: hb.x - pad, y: hb.y - pad, w: hb.w + 2 * pad, h: hb.h + 2 * pad }, canvasRect(s.doc));
    if (!reg) return;
    const off = src ? [d.dx, d.dy] : [-d.dx, -d.dy];
    const pixels = t.raster.read({ x: reg.x + off[0]!, y: reg.y + off[1]!, w: reg.w, h: reg.h });
    const sw = healWithSource(t.raster, hole, pixels, reg);
    s.commit('Patch Tool', 'heal', { ...s.doc, layers: t.layerId ? updateLayer(s.doc.layers, t.layerId, (x) => ({ ...x }) as Layer) : s.doc.layers }, [sw]);
    bump();
  },
  overlay: (o) => {
    if (lasso) drawPolyline(o, lasso, false);
    if (drag) {
      const { ctx } = o;
      ctx.save();
      for (const p of drag.outline) drawPolyline(o, p.map((v, i) => v + (i % 2 ? drag!.dy : drag!.dx)), true);
      ctx.restore();
    }
  },
};

export function patchNeedsSelection(): void {
  toast('Draw around the area to fix, then drag it to clean pixels.');
}
