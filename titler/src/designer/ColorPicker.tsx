// The color picker: saturation and brightness in a square, hue and
// opacity sliders, HSB / RGB / HEX numbers, the eyedropper (where the
// browser has one), the event look's colors and the title's own swatches.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Pipette, Plus } from 'lucide-react';

export interface Swatches {
  /** The title's own swatches (shared by every color in it). */
  list: string[];
  add(color: string): void;
  remove(color: string): void;
  /** The event look's colors (name, color). */
  brand: [string, string][];
}

export const SwatchContext = createContext<Swatches | null>(null);

export interface Hsv {
  h: number;
  s: number;
  v: number;
  a: number;
}

/** "#rrggbb[aa]" → HSB (h 0–360, s and v 0–100) and alpha 0–1. */
export function hexToHsv(hex: string): Hsv {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255 || 0;
  const r = n(0);
  const g = n(2);
  const b = n(4);
  const a = h.length === 8 ? n(6) : 1;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(((hue * 60 + 360) % 360) * 10) / 10, s: max ? Math.round((d / max) * 1000) / 10 : 0, v: Math.round(max * 1000) / 10, a };
}

export function hsvToRgb({ h, s, v }: Pick<Hsv, 'h' | 's' | 'v'>): [number, number, number] {
  const S = s / 100;
  const V = v / 100;
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return V - V * S * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

const two = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

export function hsvToHex(c: Hsv): string {
  const [r, g, b] = hsvToRgb(c);
  return `#${two(r)}${two(g)}${two(b)}${c.a < 0.999 ? two(c.a * 255) : ''}`;
}

const rgbToHex = (r: number, g: number, b: number, a = 1) => `#${two(r)}${two(g)}${two(b)}${a < 0.999 ? two(a * 255) : ''}`;

type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };

/** A picker over a color; `onChange` gets "#rrggbb" or "#rrggbbaa". */
export function ColorPicker({ value, onChange, onPick, label }: { value: string; onChange: (hex: string) => void; onPick?: (ref: string) => void; label: string }) {
  const [c, setC] = useState<Hsv>(() => hexToHsv(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setC(hexToHsv(value));
    }
  }, [value]);
  const sw = useContext(SwatchContext);
  const set = (next: Hsv) => {
    setC(next);
    const hex = hsvToHex(next);
    last.current = hex;
    onChange(hex);
  };
  const [r, g, b] = hsvToRgb(c);
  const drag = (el: HTMLElement, e: React.PointerEvent, fn: (x: number, y: number) => void) => {
    el.setPointerCapture?.(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      fn(Math.min(1, Math.max(0, (ev.clientX - rect.left) / (rect.width || 1))), Math.min(1, Math.max(0, (ev.clientY - rect.top) / (rect.height || 1))));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const Dropper = (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const pure = hsvToHex({ h: c.h, s: 100, v: 100, a: 1 });
  const solid = rgbToHex(r, g, b);
  const num = (v: number, lo: number, hi: number, name: string, fn: (n: number) => void) => (
    <label className="tt-cpk-num">
      <span>{name}</span>
      <input
        aria-label={`${label} ${name}`}
        inputMode="decimal"
        value={Math.round(v)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) fn(Math.min(hi, Math.max(lo, n)));
        }}
      />
    </label>
  );
  return (
    <div className="tt-cpk" role="dialog" aria-label={`${label} color picker`}>
      <div
        className="tt-cpk-sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})` }}
        onPointerDown={(e) => drag(e.currentTarget, e, (x, y) => set({ ...c, s: x * 100, v: (1 - y) * 100 }))}
        aria-label="Saturation and brightness"
      >
        <i style={{ left: `${c.s}%`, top: `${100 - c.v}%` }} />
      </div>
      <div className="tt-cpk-hue" onPointerDown={(e) => drag(e.currentTarget, e, (x) => set({ ...c, h: x * 360 }))} aria-label="Hue">
        <i style={{ left: `${(c.h / 360) * 100}%` }} />
      </div>
      <div
        className="tt-cpk-alpha"
        style={{ backgroundImage: `linear-gradient(to right, transparent, ${solid})` }}
        onPointerDown={(e) => drag(e.currentTarget, e, (x) => set({ ...c, a: Math.round(x * 100) / 100 }))}
        aria-label="Opacity"
      >
        <i style={{ left: `${c.a * 100}%` }} />
      </div>
      <div className="tt-cpk-row">
        {num(c.h, 0, 360, 'H', (h) => set({ ...c, h }))}
        {num(c.s, 0, 100, 'S', (s) => set({ ...c, s }))}
        {num(c.v, 0, 100, 'B', (v) => set({ ...c, v }))}
        {num(c.a * 100, 0, 100, 'A', (a) => set({ ...c, a: a / 100 }))}
      </div>
      <div className="tt-cpk-row">
        {num(r, 0, 255, 'R', (n) => set({ ...hexToHsv(rgbToHex(n, g, b)), a: c.a }))}
        {num(g, 0, 255, 'G', (n) => set({ ...hexToHsv(rgbToHex(r, n, b)), a: c.a }))}
        {num(b, 0, 255, 'B', (n) => set({ ...hexToHsv(rgbToHex(r, g, n)), a: c.a }))}
        {Dropper && (
          <button
            className="tt-ico"
            aria-label="Pick a color from the screen"
            title="Eyedropper: pick a color from the screen"
            onClick={() =>
              void new Dropper()
                .open()
                .then((x) => set({ ...hexToHsv(x.sRGBHex), a: c.a }))
                .catch(() => {})
            }
          >
            <Pipette size={13} />
          </button>
        )}
      </div>
      {sw && (
        <div className="tt-cpk-swatches">
          {sw.brand.map(([name, color]) => (
            <button
              key={name}
              className="tt-cpk-sw brand"
              style={{ background: color }}
              title={`Event look: ${name} (follows the event's colors)`}
              aria-label={`Event look ${name}`}
              onClick={() => (onPick ? onPick(`$${name}`) : set(hexToHsv(color)))}
            />
          ))}
          <span className="tt-cpk-gap" />
          {sw.list.map((color) => (
            <button
              key={color}
              className="tt-cpk-sw"
              style={{ background: color }}
              title={`${color} (right-click to remove)`}
              aria-label={`Swatch ${color}`}
              onClick={() => set(hexToHsv(color))}
              onContextMenu={(e) => {
                e.preventDefault();
                sw.remove(color);
              }}
            />
          ))}
          <button className="tt-ico" aria-label="Add this color to the swatches" title="Add this color to the title's swatches" onClick={() => sw.add(hsvToHex(c))}>
            <Plus size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
