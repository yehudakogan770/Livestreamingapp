// Stills and the reference wipe (the Color page's viewer): grab the frame
// on screen as a still, then show any still over the picture with a line
// that wipes between them, to match shots by eye (like Resolve's gallery
// wipe or Premiere's comparison view). Stills last while Studio is open.
import { Images } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Engine } from '../player/engine';
import { timecode } from '../model/build';

export interface Still {
  id: string;
  /** Where it was grabbed (the sequence and the time). */
  name: string;
  url: string;
}

export interface CompareState {
  stills: Still[];
  /** The still shown over the picture, or null. */
  showing: string | null;
  /** Where the wipe line is (0–1 across): the still is on its left. */
  at: number;
}

/** The most stills kept (the oldest go first). */
export const MOST_STILLS = 24;

class Compare {
  state: CompareState = { stills: [], showing: null, at: 0.5 };
  private listeners = new Set<() => void>();
  private n = 0;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  private set(s: Partial<CompareState>) {
    this.state = { ...this.state, ...s };
    for (const f of this.listeners) f();
  }
  add(name: string, url: string): Still {
    this.n += 1;
    const still = { id: `still${this.n}`, name, url };
    this.set({ stills: [...this.state.stills, still].slice(-MOST_STILLS), showing: this.state.showing });
    return still;
  }
  remove(id: string) {
    this.set({ stills: this.state.stills.filter((s) => s.id !== id), showing: this.state.showing === id ? null : this.state.showing });
  }
  show(id: string | null) {
    this.set({ showing: id });
  }
  wipe(at: number) {
    this.set({ at: Math.max(0, Math.min(1, at)) });
  }
}

export const compare = new Compare();
export const useCompare = (): CompareState => useSyncExternalStore(compare.subscribe, () => compare.state);

/** The frame on screen as a JPEG (960 across, the sequence's shape). */
export function grabStill(engine: Engine, shape: number): string | null {
  const gl = engine.gl;
  if (!gl) return null;
  const w = 960;
  const h = Math.max(2, Math.round(w / Math.max(0.1, shape)));
  let px: Uint8Array;
  try {
    px = gl.readSmall(w, h);
  } catch {
    return null;
  }
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  img.data.set(px);
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/jpeg', 0.9);
}

/** The viewer's Stills button: grab one, choose the one to compare with, take them away. */
export function StillsButton({ engine, seqName, frame, fps, shape }: { engine: Engine; seqName: string; frame: number; fps: number; shape: number }) {
  const s = useCompare();
  const [open, setOpen] = useState(false);
  const grab = () => {
    const url = grabStill(engine, shape);
    if (!url) return;
    const still = compare.add(`${seqName} ${timecode(frame, fps)}`, url);
    compare.show(still.id);
  };
  return (
    <span className="expo">
      <button
        type="button"
        className={`tbtn tbtn--icon${s.showing ? ' is-on' : ''}`}
        aria-label="Stills"
        aria-expanded={open}
        title="Stills: grab the frame, and wipe between a still and the picture"
        onClick={() => setOpen(!open)}
      >
        <Images />
      </button>
      {open && (
        <div className="expo__menu cmp__menu" role="menu" aria-label="Stills">
          <button type="button" role="menuitem" onClick={grab}>
            Grab a still
          </button>
          {s.stills.length > 0 && (
            <button type="button" role="menuitemradio" aria-checked={!s.showing} className={!s.showing ? 'is-on' : ''} onClick={() => compare.show(null)}>
              Don&apos;t compare
            </button>
          )}
          {[...s.stills].reverse().map((st) => (
            <span key={st.id} className="cmp__row">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={s.showing === st.id}
                className={s.showing === st.id ? 'is-on' : ''}
                onClick={() => compare.show(st.id)}
                title="Compare the picture with this still"
              >
                <img src={st.url} alt="" className="cmp__thumb" />
                {st.name}
              </button>
              <button type="button" className="tbtn" aria-label={`Remove ${st.name}`} onClick={() => compare.remove(st.id)}>
                ×
              </button>
            </span>
          ))}
          {!s.stills.length && <p className="cmp__hint">Grab a still of a shot you like, then compare others with it as you grade.</p>}
        </div>
      )}
    </span>
  );
}

/** The still over the viewer's picture, left of the wipe line (drag the line). */
export function CompareOverlay() {
  const s = useCompare();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const still = s.stills.find((x) => x.id === s.showing);
  useEffect(() => {
    if (!still) return;
    const move = (e: PointerEvent) => {
      if (!drag.current || !box.current) return;
      const r = box.current.getBoundingClientRect();
      compare.wipe((e.clientX - r.left) / Math.max(1, r.width));
    };
    const up = () => (drag.current = false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [still]);
  if (!still) return null;
  const pct = `${(s.at * 100).toFixed(2)}%`;
  return (
    <div ref={box} className="cmp" aria-label="Reference wipe">
      <img src={still.url} alt={`Still: ${still.name}`} className="cmp__img" style={{ clipPath: `inset(0 calc(100% - ${pct}) 0 0)` }} draggable={false} />
      <div
        className="cmp__line"
        style={{ left: pct }}
        role="slider"
        aria-label="Wipe between the still and the picture"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s.at * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          drag.current = true;
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') compare.wipe(s.at - 0.02);
          if (e.key === 'ArrowRight') compare.wipe(s.at + 0.02);
          e.stopPropagation();
        }}
      />
      <span className="cmp__label cmp__label--l">Still</span>
      <span className="cmp__label cmp__label--r">Now</span>
    </div>
  );
}
