// Color (a saturation/brightness square, a hue strip, RGB and hex) and
// Swatches (click: foreground, Alt+click: delete, the plus adds the
// foreground color).

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { app, useApp, pushRecentColor } from '../../app/state';
import { hsbToRgb, rgbToHsb, hex, parseHex } from '../../core/color';
import { NumberField } from '../fields';

type RGB = [number, number, number];

/** The square and the strip, shared with the color picker dialog. */
export function HsbPicker({ color, onChange, height = 150 }: { color: RGB; onChange: (c: RGB, final: boolean) => void; height?: number }) {
  const [hsb, setHsb] = useState(() => rgbToHsb(...color));
  const last = useRef(color);
  useEffect(() => {
    // Follow outside changes without losing the hue of grays.
    if (color.some((v, i) => Math.abs(v - last.current[i]!) > 1e-4)) {
      const n = rgbToHsb(...color);
      setHsb((h) => [n[1] < 1e-4 || n[2] < 1e-4 ? h[0] : n[0], n[2] < 1e-4 ? h[1] : n[1], n[2]]);
      last.current = color;
    }
  }, [color]);
  const sv = useRef<HTMLCanvasElement>(null);
  const hue = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = sv.current;
    if (!c) return;
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const im = ctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const [r, g, b] = hsbToRgb(hsb[0], x / 127, 1 - y / 127);
        const o = (y * 128 + x) * 4;
        im.data[o] = r * 255;
        im.data[o + 1] = g * 255;
        im.data[o + 2] = b * 255;
        im.data[o + 3] = 255;
      }
    ctx.putImageData(im, 0, 0);
  }, [hsb[0]]);
  useEffect(() => {
    const c = hue.current;
    if (!c) return;
    c.width = 360;
    c.height = 1;
    const ctx = c.getContext('2d')!;
    const im = ctx.createImageData(360, 1);
    for (let x = 0; x < 360; x++) {
      const [r, g, b] = hsbToRgb(x, 1, 1);
      im.data.set([r * 255, g * 255, b * 255, 255], x * 4);
    }
    ctx.putImageData(im, 0, 0);
  }, []);
  const emit = (h: [number, number, number], final: boolean) => {
    setHsb(h);
    const c = hsbToRgb(h[0], h[1], h[2]);
    last.current = c;
    onChange(c, final);
  };
  const dragSV = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }, final: boolean) => {
      const r = el.getBoundingClientRect();
      emit([hsb[0], Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height))], final);
    };
    at(e, false);
    const move = (ev: PointerEvent) => at(ev, false);
    const up = (ev: PointerEvent) => {
      at(ev, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const dragHue = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number }, final: boolean) => {
      const r = el.getBoundingClientRect();
      emit([Math.min(359.9, Math.max(0, ((ev.clientX - r.left) / r.width) * 360)), hsb[1], hsb[2]], final);
    };
    at(e, false);
    const move = (ev: PointerEvent) => at(ev, false);
    const up = (ev: PointerEvent) => {
      at(ev, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div>
      <div className="lp-sv" style={{ height }} onPointerDown={dragSV} role="slider" aria-label="Saturation and brightness" aria-valuenow={Math.round(hsb[1] * 100)}>
        <canvas ref={sv} />
        <span className="lp-sv-dot" style={{ left: `${hsb[1] * 100}%`, top: `${(1 - hsb[2]) * 100}%`, background: hex(color) }} />
      </div>
      <div className="lp-hue" onPointerDown={dragHue} role="slider" aria-label="Hue" aria-valuenow={Math.round(hsb[0])}>
        <canvas ref={hue} />
        <span className="lp-hue-knob" style={{ left: `${(hsb[0] / 360) * 100}%` }} />
      </div>
    </div>
  );
}

export function RgbFields({ color, onChange }: { color: RGB; onChange: (c: RGB) => void }) {
  const [text, setText] = useState(hex(color));
  useEffect(() => setText(hex(color)), [color]);
  return (
    <div className="lp-panel-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
      {(['R', 'G', 'B'] as const).map((n, i) => (
        <NumberField
          key={n}
          label={n}
          value={Math.round(color[i]! * 255)}
          min={0}
          max={255}
          width={38}
          onChange={(v) => {
            const c = [...color] as RGB;
            c[i] = v / 255;
            onChange(c);
          }}
        />
      ))}
      <span className="lp-opt">
        <span>#</span>
        <input
          className="lp-input"
          style={{ width: 66, fontFamily: 'var(--mono)' }}
          value={text.replace('#', '')}
          aria-label="Hex color"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          onBlur={() => {
            const c = parseHex(text);
            if (c) onChange(c);
            else setText(hex(color));
          }}
        />
      </span>
    </div>
  );
}

export function ColorPanel() {
  const fg = useApp((s) => s.fg);
  const bg = useApp((s) => s.bg);
  const recent = useApp((s) => s.recentColors);
  const [which, setWhich] = useState<'fg' | 'bg'>('fg');
  const color = which === 'fg' ? fg : bg;
  const set = (c: RGB, final = true) => {
    app.set(which === 'fg' ? { fg: c } : { bg: c });
    if (final) pushRecentColor(c);
  };
  return (
    <div className="lp-panel">
      <div className="lp-panel-row">
        <div className="lp-colors" style={{ marginTop: 0, width: 40, height: 36 }}>
          <button className="lp-fg" style={{ background: hex(fg), outline: which === 'fg' ? '1.5px solid var(--accent)' : undefined }} aria-label="Edit foreground color" onClick={() => setWhich('fg')} />
          <button className="lp-bg" style={{ background: hex(bg), outline: which === 'bg' ? '1.5px solid var(--accent)' : undefined }} aria-label="Edit background color" onClick={() => setWhich('bg')} />
        </div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: 1 }}>
          {recent.slice(0, 10).map((c, i) => (
            <button key={i} className="lp-swatch" style={{ background: hex(c), width: 16, height: 16 }} title={hex(c)} aria-label={`Recent color ${hex(c)}`} onClick={() => set(c)} />
          ))}
        </div>
      </div>
      <HsbPicker color={color} onChange={(c, f) => set(c, f)} height={96} />
      <RgbFields color={color} onChange={(c) => set(c)} />
    </div>
  );
}

export function SwatchesPanel() {
  const swatches = useApp((s) => s.swatches);
  return (
    <div className="lp-panel">
      <div className="lp-swatches">
        {swatches.map((c, i) => (
          <button
            key={i}
            style={{ background: hex(c) }}
            title={`${hex(c)} (Alt+click to delete)`}
            aria-label={`Swatch ${hex(c)}`}
            onClick={(e) => {
              if (e.altKey) {
                app.set((s) => ({ swatches: s.swatches.filter((_, j) => j !== i) }));
                return;
              }
              if (e.ctrlKey || e.metaKey) app.set({ bg: c });
              else app.set({ fg: c });
              pushRecentColor(c);
            }}
          />
        ))}
        <button title="Add the foreground color" aria-label="Add the foreground color" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--field)' }} onClick={() => app.set((s) => ({ swatches: [...s.swatches, s.fg] }))}>
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
