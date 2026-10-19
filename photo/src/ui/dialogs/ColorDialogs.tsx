// The Color Picker and the Gradient Editor.

import { useRef, useState } from 'react';
import { app, closeDialog, pushRecentColor, setOpts, bump } from '../../app/state';
import { Dialog, OkCancel, NumberField, Slider } from '../fields';
import { HsbPicker, RgbFields } from '../panels/ColorPanel';
import { hex, rgbToHsb, hsbToRgb, rgbToLab, labToRgb, rgbToCmyk } from '../../core/color';
import { GRADIENT_PRESETS, sampleGradient, type Gradient } from '../../core/gradient';
import { gradientCss } from '../util';
import { applyCharStyle } from '../../app/tools/typeTool';
import { current } from '../../app/state';

type RGB = [number, number, number];
type P = Record<string, unknown>;

function initialColor(p: P): RGB {
  const st = app.get();
  if (Array.isArray(p.color)) return (p.color as number[]).slice(0, 3) as RGB;
  switch (p.target) {
    case 'bg':
      return st.bg;
    case 'shapeFill':
      return st.opts.shape.fill ?? st.fg;
    case 'shapeStroke':
      return st.opts.shape.stroke ?? st.fg;
    default:
      return st.fg;
  }
}

export function ColorPickerDialog({ p, onClose }: { p: P; onClose: () => void }) {
  const [old] = useState<RGB>(() => initialColor(p));
  const [c, setC] = useState<RGB>(old);
  const hsb = rgbToHsb(...c);
  const lab = rgbToLab(...c);
  const cmyk = rgbToCmyk(...c);
  const ok = () => {
    pushRecentColor(c);
    switch (p.target) {
      case 'fg':
        app.set({ fg: c });
        break;
      case 'bg':
        app.set({ bg: c });
        break;
      case 'shapeFill':
        setOpts('shape', { fill: c });
        break;
      case 'shapeStroke':
        setOpts('shape', { stroke: c });
        break;
      case 'text':
        app.set({ fg: c });
        if (current()?.activeLayer()?.kind === 'text') applyCharStyle({ color: c });
        break;
    }
    (p.onPick as ((c: RGB) => void) | undefined)?.(c);
    onClose();
    bump();
  };
  const title = p.target === 'bg' ? 'Color Picker (Background Color)' : p.target === 'fg' ? 'Color Picker (Foreground Color)' : 'Color Picker';
  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={560}
      foot={
        <>
          <button className="lp-btn" onClick={() => app.set((s) => ({ swatches: [...s.swatches, c] }))}>
            Add to Swatches
          </button>
          <OkCancel onOk={ok} onCancel={onClose} />
        </>
      }
    >
      <div className="lp-cols">
        <div style={{ flex: 1 }}>
          <HsbPicker color={c} onChange={(x) => setC(x)} height={240} />
        </div>
        <div style={{ width: 190 }}>
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--line-2)', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ height: 34, background: hex(c) }} title="New" />
            <button style={{ height: 34, background: hex(old) }} title="Current (click to go back)" aria-label="Current color" onClick={() => setC(old)} />
          </div>
          <div className="lp-form" style={{ gridTemplateColumns: 'auto 1fr', gap: '5px 8px' }}>
            <label>H</label>
            <NumberField value={hsb[0]} min={0} max={360} suffix="°" width={48} onChange={(v) => setC(hsbToRgb(v % 360, hsb[1], hsb[2]))} />
            <label>S</label>
            <NumberField value={hsb[1] * 100} min={0} max={100} suffix="%" width={48} onChange={(v) => setC(hsbToRgb(hsb[0], v / 100, hsb[2]))} />
            <label>B</label>
            <NumberField value={hsb[2] * 100} min={0} max={100} suffix="%" width={48} onChange={(v) => setC(hsbToRgb(hsb[0], hsb[1], v / 100))} />
            <label>L</label>
            <NumberField value={lab[0]} min={0} max={100} width={48} onChange={(v) => setC(labToRgb(v, lab[1], lab[2]))} />
            <label>a</label>
            <NumberField value={lab[1]} min={-128} max={127} width={48} onChange={(v) => setC(labToRgb(lab[0], v, lab[2]))} />
            <label>b</label>
            <NumberField value={lab[2]} min={-128} max={127} width={48} onChange={(v) => setC(labToRgb(lab[0], lab[1], v))} />
          </div>
          <div className="lp-note" style={{ marginTop: 8 }}>
            C {Math.round(cmyk[0] * 100)}% M {Math.round(cmyk[1] * 100)}% Y {Math.round(cmyk[2] * 100)}% K {Math.round(cmyk[3] * 100)}%
          </div>
        </div>
      </div>
      <RgbFields color={c} onChange={setC} />
    </Dialog>
  );
}

// ---- Gradient Editor ----

export function GradientEditorDialog({ p, onClose }: { p: P; onClose: () => void }) {
  const [g, setG] = useState<Gradient>(() => structuredClone((p.gradient as Gradient) ?? GRADIENT_PRESETS[0]!));
  const [sel, setSel] = useState<{ kind: 'color' | 'alpha'; i: number }>({ kind: 'color', i: 0 });
  const [picking, setPicking] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const ok = () => {
    (p.onPick as ((g: Gradient) => void) | undefined)?.(g);
    onClose();
  };
  const posAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const dragStop = (kind: 'color' | 'alpha', i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    setSel({ kind, i });
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const pos = posAt(ev.clientX);
      setG((cur) => {
        const n = structuredClone(cur);
        const list = kind === 'color' ? n.stops : n.alphas;
        // Drag away to delete (keep at least two).
        if (Math.abs(ev.clientY - y0) > 40 && list.length > 2) return cur;
        list[i]!.pos = pos;
        return n;
      });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (Math.abs(ev.clientY - y0) > 40)
        setG((cur) => {
          const n = structuredClone(cur);
          const list = kind === 'color' ? n.stops : n.alphas;
          if (list.length > 2) list.splice(i, 1);
          return n;
        });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const stop = sel.kind === 'color' ? g.stops[sel.i] : g.alphas[sel.i];
  return (
    <Dialog title="Gradient Editor" onClose={onClose} width={560} foot={<OkCancel onOk={ok} onCancel={onClose} />}>
      <div className="lp-section-title" style={{ marginTop: 0 }}>
        Presets
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, marginBottom: 14 }}>
        {GRADIENT_PRESETS.map((pr) => (
          <button key={pr.name} title={pr.name} aria-label={pr.name} style={{ height: 30, borderRadius: 3, border: '1px solid var(--line-2)', background: gradientCss(pr) }} onClick={() => setG(structuredClone(pr))} />
        ))}
      </div>
      <div className="lp-panel-row">
        <span className="lp-label">Name</span>
        <input className="lp-input" style={{ flex: 1 }} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label="Gradient name" />
      </div>
      <div style={{ position: 'relative', padding: '18px 8px 30px' }}>
        {/* Opacity stops above, color stops below. */}
        {g.alphas.map((a, i) => (
          <span
            key={`a${i}`}
            className={`lp-gradient-stop${sel.kind === 'alpha' && sel.i === i ? ' lp-sel' : ''}`}
            style={{ left: `calc(8px + (100% - 16px) * ${a.pos})`, top: 2, background: `rgb(${Math.round(a.alpha * 255)},${Math.round(a.alpha * 255)},${Math.round(a.alpha * 255)})` }}
            onPointerDown={dragStop('alpha', i)}
            role="slider"
            aria-label={`Opacity stop ${i + 1}`}
            aria-valuenow={Math.round(a.pos * 100)}
          />
        ))}
        <div
          ref={bar}
          className="lp-gradient-bar"
          style={{ height: 28, background: `${gradientCss(g)}, repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 10px 10px` }}
          onPointerDown={(e) => {
            // Click below/above the bar adds a stop.
            const pos = posAt(e.clientX);
            const r = bar.current!.getBoundingClientRect();
            if (e.clientY > r.top + r.height / 2) {
              const c = sampleGradient(g, pos);
              const n = structuredClone(g);
              n.stops.push({ pos, color: [c[0], c[1], c[2]] });
              setG(n);
              setSel({ kind: 'color', i: n.stops.length - 1 });
            } else {
              const n = structuredClone(g);
              n.alphas.push({ pos, alpha: sampleGradient(g, pos)[3] });
              setG(n);
              setSel({ kind: 'alpha', i: n.alphas.length - 1 });
            }
          }}
          title="Click the lower half to add a color stop, the upper half to add an opacity stop"
        />
        {g.stops.map((s, i) => (
          <span
            key={`c${i}`}
            className={`lp-gradient-stop${sel.kind === 'color' && sel.i === i ? ' lp-sel' : ''}`}
            style={{ left: `calc(8px + (100% - 16px) * ${s.pos})`, top: 50, background: hex(s.color) }}
            onPointerDown={dragStop('color', i)}
            onDoubleClick={() => {
              setSel({ kind: 'color', i });
              setPicking(true);
            }}
            role="slider"
            aria-label={`Color stop ${i + 1}`}
            aria-valuenow={Math.round(s.pos * 100)}
          />
        ))}
      </div>
      {stop && (
        <div className="lp-panel-row" style={{ gap: 14 }}>
          {sel.kind === 'color' ? (
            <>
              <span className="lp-label">Color</span>
              <button className="lp-swatch" style={{ background: hex((stop as Gradient['stops'][number]).color) }} aria-label="Stop color" onClick={() => setPicking(true)} />
            </>
          ) : (
            <NumberField
              label="Opacity"
              value={Math.round((stop as Gradient['alphas'][number]).alpha * 100)}
              min={0}
              max={100}
              suffix="%"
              width={44}
              onChange={(v) => {
                const n = structuredClone(g);
                n.alphas[sel.i]!.alpha = v / 100;
                setG(n);
              }}
            />
          )}
          <NumberField
            label="Location"
            value={Math.round(stop.pos * 100)}
            min={0}
            max={100}
            suffix="%"
            width={44}
            onChange={(v) => {
              const n = structuredClone(g);
              (sel.kind === 'color' ? n.stops : n.alphas)[sel.i]!.pos = v / 100;
              setG(n);
            }}
          />
          <button
            className="lp-btn"
            disabled={(sel.kind === 'color' ? g.stops : g.alphas).length <= 2}
            onClick={() => {
              const n = structuredClone(g);
              (sel.kind === 'color' ? n.stops : n.alphas).splice(sel.i, 1);
              setG(n);
              setSel({ kind: sel.kind, i: 0 });
            }}
          >
            Delete
          </button>
        </div>
      )}
      {sel.kind === 'color' && g.stops[sel.i] && sel.i < g.stops.length - 1 && (
        <Slider
          label="Midpoint"
          value={g.stops[sel.i]!.mid ?? 0.5}
          min={0.05}
          max={0.95}
          step={0.01}
          scale={100}
          suffix="%"
          onChange={(v) => {
            const n = structuredClone(g);
            n.stops[sel.i]!.mid = v;
            setG(n);
          }}
        />
      )}
      {picking && sel.kind === 'color' && g.stops[sel.i] && (
        <ColorPickerDialog
          p={{
            color: g.stops[sel.i]!.color,
            onPick: (c: RGB) => {
              const n = structuredClone(g);
              n.stops[sel.i]!.color = c;
              setG(n);
            },
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Dialog>
  );
}

export { closeDialog };
