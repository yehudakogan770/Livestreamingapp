// The render cache at work: it plans the open sequence's segments, makes the
// ones it should in the background while playback is stopped (nearest the
// playhead first, drawn by the same compositor as the film and encoded by
// FFmpeg), and hands playback the cached pictures where they are up to date.
import { current, rate } from '../model/seq';
import type { Project, Sequence } from '../model/types';
import { inApp, native } from '../native';
import { manageNative } from '../manage/native';
import { Compositor } from '../render/compositor';
import { frameOps, type Op } from '../render/frame';
import { rateText } from '../export/ffargs';
import { Sources } from '../export/exporter';
import { segmentFrames } from './key';
import { cacheNative } from './native';
import { cachedOps } from './ops';
import { coverage, planSegments, renderOrder, segmentAt, type Segment } from './plan';
import { DEFAULT_SETTINGS, formatFor, loadSettings, saveSettings, widthFor, type CacheSettings } from './settings';

/** What the cache needs from the editor: the project, whether it is playing, and where the playhead is. */
export interface CacheFocus {
  project: Project | null;
  playing: boolean;
  playhead: number;
  proxies: boolean;
}

export interface CacheProgress {
  key: string;
  from: number;
  to: number;
  /** 0–1. */
  done: number;
}

/** How the cache is doing (for the settings and the viewer's tooltip). */
export interface CacheStats {
  /** Segments made this session. */
  made: number;
  /** Frames drawn into the cache, and how long that took (ms). */
  frames: number;
  ms: number;
  /** Bytes in the cache folder (as last listed). */
  bytes: number;
  files: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RenderCache {
  settings: CacheSettings = typeof localStorage !== 'undefined' ? loadSettings() : { ...DEFAULT_SETTINGS };
  /** Finished cache files: key → path. */
  private files = new Map<string, { path: string; bytes: number }>();
  private folderPath = '';
  private memo: { p: Project; s: Sequence; v: number; proxies: boolean; segs: Segment[] } | null = null;
  /** Bumped when a setting changes what is planned. */
  private version = 0;
  /** User mode: the ranges marked for caching, by sequence. */
  private marked = new Map<string, [number, number][]>();
  private failed = new Set<string>();
  /** The graphics card's encoder failed: software from now on. */
  private software = false;
  private running = false;
  private timer = 0;
  private listeners = new Set<() => void>();
  focus: () => CacheFocus = () => ({ project: null, playing: false, playhead: 0, proxies: true });
  progress: CacheProgress | null = null;
  readonly stats: CacheStats = { made: 0, frames: 0, ms: 0, bytes: 0, files: 0 };

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  private emit() {
    for (const f of this.listeners) f();
  }

  /** Start (in the app): read what is cached, then look for work every second. */
  async start(focus: () => CacheFocus) {
    this.focus = focus;
    if (!inApp()) return;
    if (!this.settings.hwDecode) void cacheNative.hwSet(false).catch(() => undefined);
    await this.reload();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => void this.loop(), 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  /** Read the cache folder again. */
  async reload() {
    if (!inApp()) return;
    try {
      this.folderPath = await cacheNative.folder(this.settings.folder);
      const list = await cacheNative.list(this.settings.folder);
      const sep = this.folderPath.includes('\\') ? '\\' : '/';
      this.files = new Map(list.map((e) => [e.key, { path: `${this.folderPath}${sep}${e.key}.mp4`, bytes: e.bytes }]));
      this.countBytes();
    } catch {
      this.files.clear();
    }
    this.emit();
  }

  private countBytes() {
    let b = 0;
    for (const f of this.files.values()) b += f.bytes;
    this.stats.bytes = b;
    this.stats.files = this.files.size;
  }

  get folder(): string {
    return this.folderPath;
  }

  set(change: Partial<CacheSettings>) {
    const before = this.settings;
    this.settings = { ...before, ...change };
    saveSettings(this.settings);
    this.version++;
    if (change.folder !== undefined && change.folder !== before.folder) void this.reload();
    if (change.hwDecode !== undefined && inApp()) void cacheNative.hwSet(change.hwDecode).catch(() => undefined);
    this.emit();
  }

  /** User mode: mark a range of the open sequence for caching (or clear the marks). */
  mark(seq: string, range: [number, number] | null) {
    if (!range) this.marked.delete(seq);
    else if (range[1] > range[0]) this.marked.set(seq, [...(this.marked.get(seq) ?? []), range]);
    this.version++;
    this.emit();
  }

  marks(seq: string): [number, number][] {
    return this.marked.get(seq) ?? [];
  }

  /** The open sequence's segments (worked out again only when something changed). */
  plan(p: Project, s: Sequence = current(p), proxies = this.focus().proxies): Segment[] {
    const m = this.memo;
    if (m && m.p === p && m.s === s && m.v === this.version && m.proxies === proxies) return m.segs;
    const segs = planSegments(p, s, {
      mode: this.settings.mode,
      format: formatFor(this.settings, s),
      segment: segmentFrames(rate(s)),
      ranges: this.marks(s.id),
      proxies,
    });
    this.memo = { p, s, v: this.version, proxies, segs };
    return segs;
  }

  has(key: string): boolean {
    return this.files.has(key);
  }

  /** The line over the ruler: cached and wanted-but-not-made stretches. */
  coverage(p: Project, s: Sequence) {
    if (this.settings.mode === 'off') return [];
    return coverage(this.plan(p, s), (k) => this.files.has(k));
  }

  /** Playback: the cached picture at a frame, when the cache has it up to date. */
  opsAt = (p: Project, s: Sequence, frame: number): Op[] | null => {
    if (this.settings.mode === 'off' || !this.files.size) return null;
    const seg = segmentAt(this.plan(p, s), frame);
    const f = seg && this.files.get(seg.key);
    return seg && f ? cachedOps(s, seg, f.path, frame, formatFor(this.settings, s)) : null;
  };

  /** The film: cached pictures where they are made at the film's size in high quality (and the setting allows it). */
  exportOps(p: Project, s: Sequence, frame: number, height: number): Op[] | null {
    const o = this.settings;
    if (!o.forExport || !o.high || o.mode === 'off') return null;
    const format = formatFor(o, s);
    if (format.height !== height) return null;
    const seg = segmentAt(this.plan(p, s), frame);
    const f = seg && this.files.get(seg.key);
    return seg && f ? cachedOps(s, seg, f.path, frame, format) : null;
  }

  /** Throw every cache file away. */
  async clear(): Promise<number> {
    this.progress = null;
    this.files.clear();
    this.failed.clear();
    this.countBytes();
    this.emit();
    if (!inApp()) return 0;
    return cacheNative.clear(this.settings.folder);
  }

  /** Is a segment still wanted as it was when its making began? */
  private current(key: string): boolean {
    const f = this.focus();
    if (!f.project || this.settings.mode === 'off') return false;
    return this.plan(f.project).some((x) => x.key === key && x.needs);
  }

  /** Make the wanted segments, one at a time, while playback is stopped. */
  private async loop() {
    if (this.running || !inApp()) return;
    this.running = true;
    try {
      for (;;) {
        const f = this.focus();
        if (!f.project || f.playing || this.settings.mode === 'off') break;
        const s = current(f.project);
        const todo = renderOrder(
          this.plan(f.project, s).filter((x) => x.needs && !this.files.has(x.key) && !this.failed.has(x.key)),
          f.playhead,
        );
        const next = todo[0];
        if (!next) break;
        await this.make(f.project, s, next);
        await sleep(30);
      }
    } finally {
      this.running = false;
    }
  }

  private async make(p: Project, s: Sequence, seg: Segment) {
    const format = formatFor(this.settings, s);
    const height = format.height;
    const width = widthFor(height, s);
    const fps = rate(s);
    const folder = this.settings.folder;
    let id: number;
    try {
      id = await cacheNative.open(folder, seg.key, width, height, rateText(s.fps), format.high, this.software || !this.settings.hwEncode);
    } catch {
      this.failed.add(seg.key);
      return;
    }
    const canvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const sources = new Sources({ width, height }, fps);
    const readText = (path: string) => native.readText(path);
    const t0 = performance.now();
    let sent = 0;
    let gl: Compositor | null = null;
    try {
      gl = new Compositor(canvas);
      gl.resize(width, height, s.height);
      for (let f = seg.from; f < seg.to; f++) {
        // Playback started, or an edit changed this segment: stop (it is made again later if still wanted).
        if (this.focus().playing || !this.current(seg.key)) {
          await cacheNative.abort(folder, seg.key, id);
          this.progress = null;
          this.emit();
          return;
        }
        const ops = frameOps(p, s, f);
        await sources.prepare(ops, f, readText);
        await sources.mattes(ops);
        await manageNative.encodeFrame(id, gl.readFrame(ops, sources.pictures, s.background, false));
        sent++;
        this.progress = { key: seg.key, from: seg.from, to: seg.to, done: (f - seg.from + 1) / (seg.to - seg.from) };
        if (sent % 6 === 0) {
          this.emit();
          // Let the page breathe.
          await sleep(0);
        }
      }
      const path = await cacheNative.finish(folder, seg.key, id);
      this.files.set(seg.key, { path, bytes: 0 });
      this.stats.made++;
      this.stats.frames += sent;
      this.stats.ms += performance.now() - t0;
      this.progress = null;
      if (this.stats.made % 10 === 0) await this.trim();
      else this.countBytes();
      this.emit();
    } catch {
      await cacheNative.abort(folder, seg.key, id).catch(() => undefined);
      // The graphics card's encoder failed at the start: the software encoder from now on.
      if (!this.software && sent < 3 && this.settings.hwEncode) this.software = true;
      else this.failed.add(seg.key);
      this.progress = null;
      this.emit();
    } finally {
      await sources.close();
      // Each segment's graphics context is let go at once (browsers keep only a few, and the viewer's would be lost).
      gl?.dispose();
    }
  }

  /** Keep the cache under its size limit (the open sequence's files stay). */
  async trim() {
    const f = this.focus();
    const keep = f.project ? this.plan(f.project).map((x) => x.key) : [];
    try {
      const gone = await cacheNative.trim(this.settings.folder, Math.round(this.settings.limitGb * 1024 ** 3), keep);
      for (const k of gone) this.files.delete(k);
      const list = await cacheNative.list(this.settings.folder);
      for (const e of list) {
        const had = this.files.get(e.key);
        if (had) had.bytes = e.bytes;
      }
    } catch {
      // Tried again later.
    }
    this.countBytes();
  }
}

/** The editor's render cache. */
export const renderCache = new RenderCache();
