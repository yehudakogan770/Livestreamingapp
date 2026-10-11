// Drawing the current document on the screen: the composite through the
// view transform, color-managed to the display, with the selection's
// marching ants and the quick mask. One WebGL canvas serves every tab.

import { GPU } from './context';
import { Compositor } from './compositor';
import { makeTexture } from './gl';
import { decodeTable, rgbToRgb, DISPLAY_P3, SRGB, sameProfile, type ColorProfile } from '../core/color';
import { TILE, keyX, keyY, type Raster } from '../core/raster';
import type { Session } from '../app/session';
import { docToScreenMatrix, invert } from '../app/viewMath';

export interface ViewOptions {
  pasteboard: [number, number, number];
  check1: [number, number, number];
  check2: [number, number, number];
  pixelGrid: boolean;
  time: number;
  quickColor: [number, number, number, number];
  displayP3: boolean;
  /** 32-bit documents: exposure for the screen (stops). */
  exposure: number;
}

interface SelTex {
  tex: WebGLTexture;
  w: number;
  h: number;
  raster: Raster | null;
  uploaded: Map<number, number>;
}

export class View {
  readonly gpu: GPU;
  readonly canvas: HTMLCanvasElement;
  private sel = new WeakMap<Session, SelTex>();
  private trc = new Map<string, WebGLTexture>();
  readonly p3: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This browser has no WebGL2, which Lumora Photo needs to draw pictures.');
    const wantP3 = typeof matchMedia === 'function' && matchMedia('(color-gamut: p3)').matches;
    const g = gl as WebGL2RenderingContext & { drawingBufferColorSpace?: string };
    this.p3 = false;
    if (wantP3 && 'drawingBufferColorSpace' in g) {
      try {
        g.drawingBufferColorSpace = 'display-p3';
        this.p3 = g.drawingBufferColorSpace === 'display-p3';
      } catch {
        this.p3 = false;
      }
    }
    this.gpu = new GPU(gl);
  }

  compositorFor(s: Session): Compositor {
    if (!s.compositor) s.compositor = new Compositor(this.gpu);
    return s.compositor;
  }

  private trcTex(p: ColorProfile): WebGLTexture {
    const key = JSON.stringify(p.trc);
    let t = this.trc.get(key);
    if (!t) {
      const gl = this.gpu.gl;
      t = makeTexture(gl, 4096, 1, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, decodeTable(p.trc, 4096));
      this.trc.set(key, t);
    }
    return t;
  }

  /** The selection as a document-size R8 texture (updated tile by tile). */
  private selTex(s: Session): SelTex | null {
    const doc = s.doc;
    const r = doc.selection?.mask ?? null;
    if (!r) return null;
    const gl = this.gpu.gl;
    let t = this.sel.get(s);
    if (!t || t.w !== doc.width || t.h !== doc.height) {
      if (t) gl.deleteTexture(t.tex);
      t = { tex: makeTexture(gl, doc.width, doc.height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST, null), w: doc.width, h: doc.height, raster: null, uploaded: new Map() };
      // Start clear.
      const zero = new Uint8Array(doc.width * Math.min(doc.height, 256));
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      for (let y = 0; y < doc.height; y += 256) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, doc.width, Math.min(256, doc.height - y), gl.RED, gl.UNSIGNED_BYTE, zero);
      this.sel.set(s, t);
    }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const zero = new Uint8Array(TILE * TILE);
    const put = (k: number, data: Uint8Array) => {
      const x = keyX(k) * TILE,
        y = keyY(k) * TILE;
      if (x >= doc.width || y >= doc.height || x < 0 || y < 0) return;
      const w = Math.min(TILE, doc.width - x),
        h = Math.min(TILE, doc.height - y);
      if (w === TILE && h === TILE) gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, TILE, TILE, gl.RED, gl.UNSIGNED_BYTE, data);
      else {
        const part = new Uint8Array(w * h);
        for (let yy = 0; yy < h; yy++) part.set(data.subarray(yy * TILE, yy * TILE + w), yy * w);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RED, gl.UNSIGNED_BYTE, part);
      }
    };
    if (t.raster !== r) {
      // A new selection: clear what the old one set.
      for (const k of t.uploaded.keys()) if (!r.tiles.has(k)) put(k, zero);
      t.uploaded.clear();
      t.raster = r;
    }
    for (const [k, tile] of r.tiles) {
      if (t.uploaded.get(k) === tile.v) continue;
      put(k, tile.data as Uint8Array);
      t.uploaded.set(k, tile.v);
    }
    for (const k of [...t.uploaded.keys()])
      if (!r.tiles.has(k)) {
        put(k, zero);
        t.uploaded.delete(k);
      }
    return t;
  }

  /** Draw the session's document to the canvas. */
  draw(s: Session, o: ViewOptions, showMask: { raster: Raster; bg: number } | null = null): void {
    const gpu = this.gpu;
    const gl = gpu.gl;
    const comp = this.compositorFor(s);
    comp.render(s.doc, s.overrides);
    const dpr = window.devicePixelRatio || 1;
    const W = this.canvas.width,
      H = this.canvas.height;
    const v = s.view;
    if (v.zoom < 1) comp.ensureMips();
    const m = invert(docToScreenMatrix(v, s.doc.width, s.doc.height));
    // Device pixels → CSS pixels → document.
    const k = 1 / dpr;
    const mat = new Float32Array([m[0] * k, m[1] * k, 0, m[2] * k, m[3] * k, 0, m[4], m[5], 1]);
    const p = gpu.program('view');
    p.tex('uComp', comp.comp!.tex).v2('uDocSize', s.doc.width, s.doc.height).m3('uScreenToDoc', mat).f('uZoom', v.zoom * dpr);
    p.v3('uPasteboard', ...o.pasteboard).v2('uViewport', W, H);
    // Color management.
    const display = this.p3 && o.displayP3 ? DISPLAY_P3 : SRGB;
    const linearDoc = s.doc.depth === 32;
    const same = !linearDoc && sameProfile(s.doc.profile, display);
    p.i('uDecode', same || linearDoc ? 0 : 1).i('uLinearDoc', linearDoc ? 1 : 0).f('uExposure', Math.pow(2, o.exposure));
    p.tex('uTrc', this.trcTex(s.doc.profile));
    const M = rgbToRgb(s.doc.profile, display);
    // GLSL mat3 is column-major.
    p.m3('uToDisplay', new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]));
    const st = this.selTex(s);
    if (st) p.tex('uSel', st.tex).i('uHasSel', 1);
    else p.i('uHasSel', 0);
    p.f('uTime', o.time).i('uQuickMask', s.quickMask ? 1 : 0).v4('uQuickColor', ...o.quickColor);
    if (s.quickMask && !st) p.i('uQuickMask', 1);
    p.i('uChecker', 1).v3('uCheck1', ...o.check1).v3('uCheck2', ...o.check2).i('uPixelGrid', o.pixelGrid ? 1 : 0);
    if (showMask) {
      const { rt } = comp.syncRaster(showMask.raster);
      if (rt.tex && showMask.raster.depth === 8) {
        p.tex('uMaskTex', rt.tex).v2('uMaskOrigin', rt.x0, rt.y0).v2('uMaskSize', rt.w, rt.h).i('uShowMask', 1);
      } else p.i('uShowMask', 0);
    } else p.i('uShowMask', 0);
    const dummy = makeDummy(gl);
    for (const n of ['uSel', 'uMaskTex']) if (!p.has(n)) p.tex(n, dummy);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

let dummyTex: WebGLTexture | null = null;
function makeDummy(gl: WebGL2RenderingContext): WebGLTexture {
  if (!dummyTex) dummyTex = makeTexture(gl, 1, 1, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST, new Uint8Array(1));
  return dummyTex;
}
