// False color and zebra stripes over the program viewer: exposure checks
// while grading and editing. The picture is read small (as the scopes read
// it) a few times a second and drawn over the viewer.
import { SunMedium } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Engine } from '../player/engine';
import { bandShares, falseColor, FALSE_COLOR, zebra } from '../render/exposure';
import './exposure.css';

export type ExposureMode = 'off' | 'false' | 'zebra';
export interface ExposureState {
  mode: ExposureMode;
  /** Zebra stripes from this brightness up (percent). */
  level: number;
}

const KEY = 'lumora-edit-exposure';

class Exposure {
  state: ExposureState = { mode: 'off', level: 95 };
  private listeners = new Set<() => void>();
  constructor() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ExposureState> | null;
      if (v && typeof v.level === 'number') this.state = { mode: 'off', level: v.level };
    } catch {
      // Defaults.
    }
  }
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  set(change: Partial<ExposureState>) {
    this.state = { ...this.state, ...change };
    for (const f of this.listeners) f();
    try {
      localStorage.setItem(KEY, JSON.stringify({ level: this.state.level }));
    } catch {
      // Not kept: fine.
    }
  }
}

export const exposure = new Exposure();
export const useExposure = (): ExposureState => useSyncExternalStore(exposure.subscribe, () => exposure.state);

/** The viewer's exposure button and its menu (off, false color, zebra and its level). */
export function ExposureButton() {
  const s = useExposure();
  const [open, setOpen] = useState(false);
  return (
    <span className="expo">
      <button
        type="button"
        className={`tbtn tbtn--icon${s.mode !== 'off' ? ' is-on' : ''}`}
        aria-label="Exposure overlay"
        aria-expanded={open}
        title="Exposure: false color or zebra stripes"
        onClick={() => setOpen(!open)}
      >
        <SunMedium />
      </button>
      {open && (
        <div className="expo__menu" role="menu" aria-label="Exposure overlay">
          {(
            [
              ['off', 'Off'],
              ['false', 'False color'],
              ['zebra', 'Zebra stripes'],
            ] as [ExposureMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={s.mode === m}
              className={s.mode === m ? 'is-on' : ''}
              onClick={() => {
                exposure.set({ mode: m });
                if (m !== 'zebra') setOpen(false);
              }}
            >
              {label}
            </button>
          ))}
          {s.mode === 'zebra' && (
            <label className="expo__level">
              From
              <select className="text" aria-label="Zebra level" value={s.level} onChange={(e) => exposure.set({ level: Number(e.target.value) })}>
                {[70, 80, 90, 95, 100].map((l) => (
                  <option key={l} value={l}>
                    {l}%
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </span>
  );
}

/** The overlay itself (over the viewer's picture, the same size). */
export function ExposureOverlay({ engine }: { engine: Engine }) {
  const s = useExposure();
  const ref = useRef<HTMLCanvasElement>(null);
  const [clipped, setClipped] = useState(0);
  useEffect(() => {
    if (s.mode === 'off') return;
    let last = 0;
    let timer = 0;
    let phase = 0;
    const draw = () => {
      const cv = ref.current;
      const gl = engine.gl;
      if (!cv || !gl) return;
      const now = performance.now();
      if (now - last < 100) {
        window.clearTimeout(timer);
        timer = window.setTimeout(draw, 110);
        return;
      }
      last = now;
      const w = cv.width;
      const h = cv.height;
      let px: Uint8Array;
      try {
        px = gl.readSmall(w, h);
      } catch {
        return;
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const img = ctx.createImageData(w, h);
      if (s.mode === 'false') {
        falseColor(px, img.data);
        setClipped(bandShares(px)[FALSE_COLOR.length - 1] ?? 0);
      } else {
        phase = (phase + 1) % 8;
        zebra(px, w, s.level, img.data, phase);
      }
      ctx.putImageData(img, 0, 0);
    };
    const stop = engine.watchFrames(draw);
    engine.redraw();
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [engine, s.mode, s.level]);
  if (s.mode === 'off') return null;
  return (
    <>
      <canvas ref={ref} className="expo__canvas" width={480} height={270} aria-hidden="true" />
      {s.mode === 'false' && (
        <div className="expo__legend" aria-label="False color scale">
          {FALSE_COLOR.filter((b) => b.color).map((b) => (
            <span key={b.label} title={b.label}>
              <i style={{ background: `rgb(${(b.color as number[]).join(',')})` }} />
              {b.label}
            </span>
          ))}
          {clipped > 0.001 && <span className="expo__clip">{(clipped * 100).toFixed(1)}% clipped</span>}
        </div>
      )}
    </>
  );
}
