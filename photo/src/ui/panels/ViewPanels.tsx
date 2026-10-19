// Navigator, Info and Histogram.

import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { current, useApp, requestFrame, onFrameRequest } from '../../app/state';
import { viewport, toDoc, toScreen } from '../../app/tools/types';
import { zoomStep, zoomBy } from '../../app/tools/viewTools';
import { zoomLabel } from '../../app/viewMath';
import { pointerInfo, onPointerInfo } from '../CanvasArea';
import { pickColor, samplersOf } from '../../app/tools/miscTools';
import { rgbToCmyk, rgbToHsb, rgbToLab } from '../../core/color';
import { compositeHistogram } from '../hist';
import { HistogramCanvas } from '../AdjustEditor';
import { Select } from '../fields';

export function NavigatorPanel() {
  useApp((s) => s.rev);
  const s = current();
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    let t = 0;
    const off = onFrameRequest(() => {
      clearTimeout(t);
      t = window.setTimeout(() => setTick((x) => x + 1), 250);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);
  useEffect(() => {
    if (!s) return;
    const th = s.compositor?.thumbnail(240);
    const c = ref.current;
    if (!th || !c) return;
    c.width = th.w;
    c.height = th.h;
    const ctx = c.getContext('2d')!;
    const im = ctx.createImageData(th.w, th.h);
    // Rows come bottom-up from the GPU.
    for (let y = 0; y < th.h; y++) {
      const src = th.data.subarray((th.h - 1 - y) * th.w * 4, (th.h - y) * th.w * 4);
      im.data.set(src, y * th.w * 4);
    }
    // Checker under see-through parts.
    for (let i = 0; i < im.data.length; i += 4) {
      const a = im.data[i + 3]! / 255;
      if (a >= 1) continue;
      const x = (i / 4) % th.w,
        y = Math.floor(i / 4 / th.w);
      const ch = ((x >> 2) + (y >> 2)) & 1 ? 204 : 255;
      for (let k = 0; k < 3; k++) im.data[i + k] = im.data[i + k]! * a + ch * (1 - a);
      im.data[i + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
  });
  if (!s) return <div className="lp-empty">No document</div>;
  // The visible part as a box on the thumbnail.
  const c = ref.current,
    w = wrap.current;
  let boxStyle: React.CSSProperties = { display: 'none' };
  if (c && w && c.width) {
    const cr = c.getBoundingClientRect(),
      wr = w.getBoundingClientRect();
    const k = cr.width / s.doc.width;
    const [x0, y0] = toDoc(0, 0, s),
      [x1, y1] = toDoc(viewport.w, viewport.h, s);
    const l = Math.min(x0, x1),
      t = Math.min(y0, y1),
      r = Math.max(x0, x1),
      b = Math.max(y0, y1);
    boxStyle = { left: cr.left - wr.left + l * k, top: cr.top - wr.top + t * k, width: (r - l) * k, height: (b - t) * k };
  }
  const panTo = (e: React.PointerEvent) => {
    const cv = ref.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const dx = ((e.clientX - r.left) / r.width) * s.doc.width,
      dy = ((e.clientY - r.top) / r.height) * s.doc.height;
    const [sx, sy] = toScreen(dx, dy, s);
    s.view = { ...s.view, cx: s.view.cx + viewport.w / 2 - sx, cy: s.view.cy + viewport.h / 2 - sy };
    s.fitted = false;
    requestFrame();
    setTick((x) => x + 1);
  };
  return (
    <div className="lp-panel">
      <div
        ref={wrap}
        className="lp-navigator"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          panTo(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) panTo(e);
        }}
      >
        <canvas ref={ref} />
        <div ref={box} className="lp-nav-box" style={boxStyle} />
      </div>
      <div className="lp-panel-row" style={{ marginTop: 8 }}>
        <span style={{ width: 54, fontVariantNumeric: 'tabular-nums' }}>{zoomLabel(s.view.zoom)}</span>
        <button className="lp-icon-btn" aria-label="Zoom out" onClick={() => zoomStep(-1)}>
          <ZoomOut size={15} />
        </button>
        <input
          type="range"
          aria-label="Zoom"
          min={Math.log(0.01)}
          max={Math.log(32)}
          step={0.01}
          value={Math.log(s.view.zoom)}
          style={{ flex: 1 }}
          onChange={(e) => zoomBy(Math.exp(parseFloat(e.target.value)) / s.view.zoom)}
        />
        <button className="lp-icon-btn" aria-label="Zoom in" onClick={() => zoomStep(1)}>
          <ZoomIn size={15} />
        </button>
      </div>
    </div>
  );
}

const f0 = (v: number) => String(Math.round(v));

export function InfoPanel() {
  useApp((s) => s.rev);
  const [, setTick] = useState(0);
  useEffect(() => onPointerInfo(() => setTick((t) => t + 1)), []);
  const s = current();
  if (!s) return <div className="lp-empty">No document</div>;
  const x = Math.floor(pointerInfo.x),
    y = Math.floor(pointerInfo.y);
  const inside = pointerInfo.inside && x >= 0 && y >= 0 && x < s.doc.width && y < s.doc.height;
  const c = inside ? pickColor(x, y) : null;
  const cmyk = c ? rgbToCmyk(...c) : null;
  const hsb = c ? rgbToHsb(...c) : null;
  const lab = c ? rgbToLab(c[0], c[1], c[2], s.doc.profile) : null;
  const b = s.doc.selection?.bounds;
  return (
    <div className="lp-panel">
      <div className="lp-info">
        <span>R</span>
        <span>{c ? f0(c[0] * 255) : ''}</span>
        <span>C</span>
        <span>{cmyk ? `${f0(cmyk[0] * 100)}%` : ''}</span>
        <span>G</span>
        <span>{c ? f0(c[1] * 255) : ''}</span>
        <span>M</span>
        <span>{cmyk ? `${f0(cmyk[1] * 100)}%` : ''}</span>
        <span>B</span>
        <span>{c ? f0(c[2] * 255) : ''}</span>
        <span>Y</span>
        <span>{cmyk ? `${f0(cmyk[2] * 100)}%` : ''}</span>
        <span>H</span>
        <span>{hsb ? `${f0(hsb[0])}°` : ''}</span>
        <span>K</span>
        <span>{cmyk ? `${f0(cmyk[3] * 100)}%` : ''}</span>
        <span>S</span>
        <span>{hsb ? `${f0(hsb[1] * 100)}%` : ''}</span>
        <span>L</span>
        <span>{lab ? f0(lab[0]) : ''}</span>
        <span>B</span>
        <span>{hsb ? `${f0(hsb[2] * 100)}%` : ''}</span>
        <span>a b</span>
        <span>{lab ? `${f0(lab[1])} ${f0(lab[2])}` : ''}</span>
      </div>
      <div className="lp-menu-sep" style={{ margin: '8px 0' }} />
      <div className="lp-info">
        <span>X</span>
        <span>{inside ? x : ''}</span>
        <span>W</span>
        <span>{b ? b.w : ''}</span>
        <span>Y</span>
        <span>{inside ? y : ''}</span>
        <span>H</span>
        <span>{b ? b.h : ''}</span>
      </div>
      <div className="lp-menu-sep" style={{ margin: '8px 0' }} />
      <div className="lp-note">
        Document: {s.doc.width} × {s.doc.height} px, {s.doc.depth}-bit, {s.doc.profile.name}
      </div>
      {samplersOf().length > 0 && (
        <>
          <div className="lp-section-title">Color Samplers</div>
          {samplersOf().map((sm, i) => {
            const v = pickColor(Math.floor(sm.x), Math.floor(sm.y));
            return (
              <div key={i} className="lp-note" style={{ fontVariantNumeric: 'tabular-nums' }}>
                #{i + 1}: {v ? `R ${f0(v[0] * 255)}  G ${f0(v[1] * 255)}  B ${f0(v[2] * 255)}` : '—'}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export function HistogramPanel() {
  useApp((s) => s.rev);
  const s = current();
  const [ch, setCh] = useState<'rgb' | 'r' | 'g' | 'b' | 'colors'>('colors');
  const [source, setSource] = useState<'composite' | 'layer'>('composite');
  const [h, setH] = useState<Uint32Array[] | null>(null);
  useEffect(() => {
    if (!s) return;
    const t = setTimeout(() => setH(compositeHistogram(s, source)), 120);
    return () => clearTimeout(t);
  });
  if (!s) return <div className="lp-empty">No document</div>;
  const idx = ch === 'colors' || ch === 'rgb' ? 3 : { r: 0, g: 1, b: 2 }[ch];
  const stats = (() => {
    const a = h?.[idx];
    if (!a) return null;
    let n = 0,
      sum = 0,
      sq = 0;
    for (let i = 0; i < 256; i++) {
      n += a[i]!;
      sum += a[i]! * i;
      sq += a[i]! * i * i;
    }
    if (!n) return null;
    const mean = sum / n;
    let acc = 0,
      median = 0;
    for (let i = 0; i < 256; i++) {
      acc += a[i]!;
      if (acc >= n / 2) {
        median = i;
        break;
      }
    }
    return { mean, dev: Math.sqrt(Math.max(0, sq / n - mean * mean)), median, n };
  })();
  return (
    <div className="lp-panel">
      <div className="lp-panel-row">
        <Select
          value={ch}
          title="Channel"
          options={[
            ['colors', 'Colors'],
            ['rgb', 'Luminosity'],
            ['r', 'Red'],
            ['g', 'Green'],
            ['b', 'Blue'],
          ]}
          onChange={setCh}
        />
        <Select
          value={source}
          title="Source"
          options={[
            ['composite', 'Entire Image'],
            ['layer', 'Selected Layer'],
          ]}
          onChange={setSource}
        />
      </div>
      {h ? <HistogramCanvas hist={h} channel={ch} height={100} /> : <div className="lp-histogram" />}
      {stats && (
        <div className="lp-info" style={{ marginTop: 8 }}>
          <span>Mean</span>
          <span>{stats.mean.toFixed(2)}</span>
          <span>Median</span>
          <span>{stats.median}</span>
          <span>Std Dev</span>
          <span>{stats.dev.toFixed(2)}</span>
          <span>Sampled</span>
          <span>{stats.n.toLocaleString('en-US')}</span>
        </div>
      )}
    </div>
  );
}
