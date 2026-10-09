// RAM preview: frames rendered ahead of the playhead and kept as bitmaps, so
// playback holds full speed on heavy compositions (like After Effects' RAM
// preview). Memory is capped by a setting; an edit throws away only the
// frames it changes (the time span of the layers it touched).

import type { Composition, Layer, TitleProject } from '../core/types';

/** A time span, composition seconds (inclusive). */
export interface Span {
  from: number;
  to: number;
}

const strip = (l: Layer): unknown => (l.type === 'group' ? { ...l, children: l.children.map((c) => c.id) } : l);

function flat(list: Layer[], out = new Map<string, Layer>()): Map<string, Layer> {
  for (const l of list) {
    out.set(l.id, l);
    if (l.type === 'group') flat(l.children, out);
  }
  return out;
}

/** Compositions whose pixels change between two projects (and every one that places them). */
function changedComps(prev: TitleProject, next: TitleProject): Set<string> {
  const out = new Set<string>();
  for (const c of next.compositions) {
    const before = prev.compositions.find((x) => x.id === c.id);
    if (!before || before !== c) {
      const pick = (x: Composition) => JSON.stringify({ ...x, cues: undefined, markers: undefined, guides: undefined, name: undefined });
      if (!before || pick(before) !== pick(c)) out.add(c.id);
    }
  }
  for (const c of prev.compositions) if (!next.compositions.some((x) => x.id === c.id)) out.add(c.id);
  return out;
}

/** Everything about a project that changes how every frame looks (not its compositions). */
const globalOf = (p: TitleProject) => JSON.stringify([p.tokens, p.variables, p.assets]);

/**
 * The frames of composition `compId` an edit changes: null when none (a
 * marker, a cue, a name), 'all' when every frame might (size, colors,
 * fields, files, layer order), else the spans of the layers it touched (and
 * of the layers moving with them, seen through them or fitted to them).
 */
export function affectedSpans(prev: TitleProject, next: TitleProject, compId: string): Span[] | 'all' | null {
  if (prev === next) return null;
  if (globalOf(prev) !== globalOf(next)) return 'all';
  const a = prev.compositions.find((c) => c.id === compId);
  const b = next.compositions.find((c) => c.id === compId);
  if (!a || !b) return 'all';
  if (a === b) {
    // Nothing in this composition itself; a precomp it places may have changed.
    const changed = changedComps(prev, next);
    const placed = merge(spansFor(b, new Set(), changed));
    return placed.length ? placed : null;
  }
  for (const k of ['width', 'height', 'fps', 'duration', 'background'] as const) if (a[k] !== b[k]) return 'all';
  const la = flat(a.layers);
  const lb = flat(b.layers);
  // Layers stacked differently: everything they cover may change; simplest is all.
  const order = (m: Map<string, Layer>) => [...m.keys()].filter((id) => la.has(id) && lb.has(id)).join('|');
  if (order(la) !== order(lb)) return 'all';
  const touched = new Set<string>();
  const spans: Span[] = [];
  for (const [id, l] of lb) {
    const before = la.get(id);
    if (before === l) continue;
    if (!before) {
      touched.add(id);
      spans.push({ from: l.start, to: l.end });
    } else if (JSON.stringify(strip(before)) !== JSON.stringify(strip(l))) {
      touched.add(id);
      spans.push({ from: Math.min(before.start, l.start), to: Math.max(before.end, l.end) });
    }
  }
  for (const [id, l] of la)
    if (!lb.has(id)) {
      touched.add(id);
      spans.push({ from: l.start, to: l.end });
    }
  const changed = changedComps(prev, next);
  changed.delete(compId);
  const all = merge([...spans, ...spansFor(b, touched, changed)]);
  return all.length ? all : null;
}

/** Layers that depend on touched layers (children, mattes, fitted boxes) or place a changed composition. */
function spansFor(c: Composition, touched: Set<string>, changedComps: Set<string>): Span[] {
  const all = flat(c.layers);
  const out: Span[] = [];
  let grew = true;
  const hit = new Set(touched);
  while (grew) {
    grew = false;
    for (const [id, l] of all) {
      if (hit.has(id)) continue;
      const depends =
        (l.parent && hit.has(l.parent)) ||
        (l.matte && hit.has(l.matte.layer)) ||
        (l.type === 'shape' && l.fitTo && hit.has(l.fitTo.layer)) ||
        (l.type === 'comp' && changedComps.has(l.comp));
      if (depends) {
        hit.add(id);
        out.push({ from: l.start, to: l.end });
        grew = true;
      }
    }
  }
  return out;
}

/** Overlapping spans joined, in order. */
export function merge(spans: Span[]): Span[] {
  const s = [...spans].sort((x, y) => x.from - y.from);
  const out: Span[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.from <= last.to + 1e-9) last.to = Math.max(last.to, x.to);
    else out.push({ ...x });
  }
  return out;
}

/** What the cache keeps: a frame's bitmap (or anything with a size and close()). */
export interface CachedFrame {
  width: number;
  height: number;
  close?(): void;
}

/**
 * Frames by number, most recently used kept, within `capBytes` (4 bytes a
 * pixel). `key` is what the frames were drawn with (composition, size,
 * values, look): a new key starts the cache again.
 */
export class FrameCache<F extends CachedFrame = CachedFrame> {
  private frames = new Map<number, F>();
  private bytes = 0;
  private listeners = new Set<() => void>();
  key = '';

  constructor(public capBytes: number) {}

  get size(): number {
    return this.frames.size;
  }
  get usedBytes(): number {
    return this.bytes;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Start again when what the frames are drawn with changes. */
  setKey(key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.clear();
  }

  has(n: number): boolean {
    return this.frames.has(n);
  }

  get(n: number): F | undefined {
    const f = this.frames.get(n);
    if (f) {
      // Most recently used goes to the end.
      this.frames.delete(n);
      this.frames.set(n, f);
    }
    return f;
  }

  /** Keep a frame; frames used longest ago go when over the cap (never `keep`'s). Returns false when it can't fit at all. */
  put(n: number, f: F, keep?: (n: number) => boolean): boolean {
    const size = f.width * f.height * 4;
    if (size > this.capBytes) {
      f.close?.();
      return false;
    }
    this.drop(n, false);
    for (const [k] of this.frames) {
      if (this.bytes + size <= this.capBytes) break;
      if (keep?.(k)) continue;
      this.drop(k, false);
    }
    if (this.bytes + size > this.capBytes) {
      f.close?.();
      return false;
    }
    this.frames.set(n, f);
    this.bytes += size;
    this.emit();
    return true;
  }

  private drop(n: number, emit = true) {
    const f = this.frames.get(n);
    if (!f) return;
    this.frames.delete(n);
    this.bytes -= f.width * f.height * 4;
    f.close?.();
    if (emit) this.emit();
  }

  /** Throw away the frames an edit changed (seconds → frames at `fps`). */
  invalidate(spans: Span[] | 'all' | null, fps: number): void {
    if (!spans) return;
    if (spans === 'all') return this.clear();
    let any = false;
    for (const n of [...this.frames.keys()]) {
      const t = n / fps;
      if (spans.some((s) => t >= s.from - 1 / fps && t <= s.to + 1 / fps)) {
        this.drop(n, false);
        any = true;
      }
    }
    if (any) this.emit();
  }

  clear(): void {
    for (const f of this.frames.values()) f.close?.();
    const had = this.frames.size > 0;
    this.frames.clear();
    this.bytes = 0;
    if (had) this.emit();
  }

  /** The cached frames as runs [first, last] (the timeline's green bar). */
  runs(): [number, number][] {
    const ns = [...this.frames.keys()].sort((a, b) => a - b);
    const out: [number, number][] = [];
    for (const n of ns) {
      const last = out[out.length - 1];
      if (last && n === last[1] + 1) last[1] = n;
      else out.push([n, n]);
    }
    return out;
  }
}

/** The preview memory setting, MB (kept in this browser). */
export const RAM_CHOICES = [256, 512, 1024, 2048, 4096];
const RAM_KEY = 'lumora-titler-ram-mb';
export function ramSetting(): number {
  try {
    const v = Number(localStorage.getItem(RAM_KEY));
    return RAM_CHOICES.includes(v) ? v : 1024;
  } catch {
    return 1024;
  }
}
export function setRamSetting(mb: number): void {
  try {
    localStorage.setItem(RAM_KEY, String(mb));
  } catch {
    // Not kept (private window).
  }
}
