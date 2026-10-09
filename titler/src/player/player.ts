// The Titler player: a title running on its own in any browser engine, with
// no Lumora around it. Exported templates (core/htmlTemplate.ts) carry this
// file (built into one script) and the title, and work in CasparCG, SPX,
// OBS and vMix browser sources, H2R Graphics, LiveOS and any OGraf renderer.
//
// It draws with the same renderer as the designer and Lumora, and keeps the
// same IN / HOLD / OUT rules (core/timeline.ts): play() takes the graphic
// (IN, then HOLD or the loop), stop() plays the OUT, update() changes fields
// on air.

import { browserEnv, requestFonts, type BrowserEnv } from '../core/browserEnv';
import { tokensFor } from '../core/binding';
import { cueEvents } from '../core/cues';
import { pickFormat } from '../core/formats';
import { renderFrame } from '../core/render';
import { cueTime, type Phase } from '../core/timeline';
import { readProject } from '../core/validate';
import type { Composition, TitleProject, Values } from '../core/types';

export type PlayerState = 'off' | Phase;

export interface PlayerOptions {
  /** Draw at this size (the element's size when left out). */
  width?: number;
  height?: number;
  /** Play the audio cues' sounds (default on). */
  sound?: boolean;
  /** The clock (ms); performance.now() when left out (tests drive it by hand). */
  now?: () => number;
  /** Draw each frame with requestAnimationFrame (default on; tests draw by hand). */
  animate?: boolean;
}

/** Field values from what a playout system sends: an object, JSON text or CasparCG's templateData XML. */
export function parseTemplateData(data: unknown): Values {
  if (data == null) return {};
  if (typeof data === 'object') return flatValues(data as Record<string, unknown>);
  const text = String(data).trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      return flatValues(JSON.parse(text) as Record<string, unknown>);
    } catch {
      return {};
    }
  }
  if (text.startsWith('<')) return xmlValues(text);
  return {};
}

function flatValues(o: Record<string, unknown>): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    if (Array.isArray(v)) out[k] = v.map((x) => String(x)).join('\n');
    else if (typeof v === 'object') {
      // CasparCG JSON: {"f0": {"text": "…"}}
      const inner = (v as Record<string, unknown>).text ?? (v as Record<string, unknown>).value;
      if (inner != null) out[k] = String(inner);
    } else out[k] = String(v);
  }
  return out;
}

/** <templateData><componentData id="name"><data id="text" value="…"/></componentData></templateData> */
function xmlValues(xml: string): Values {
  const out: Values = {};
  const decode = (s: string) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, '&');
  const comp = /<componentData\s+id\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/componentData>/g;
  for (const m of xml.matchAll(comp)) {
    const v = /<data\s+id\s*=\s*["'](?:text|value)["']\s+value\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[2]!);
    if (v) out[m[1]!] = decode(v[1] ?? v[2] ?? '');
  }
  return out;
}

/** Values from a page address (?name=Ada&title=Host): OBS and vMix browser sources. */
export function valuesFromQuery(search: string, p: TitleProject): Values {
  const q = new URLSearchParams(search);
  const out: Values = {};
  for (const v of p.variables) {
    const got = q.get(v.key);
    if (got !== null) out[v.key] = got;
  }
  return out;
}

export class TitlePlayer {
  readonly project: TitleProject;
  readonly canvas: HTMLCanvasElement;
  readonly env: BrowserEnv;
  private values: Values = {};
  private inAt: number | null = null;
  private outAt: number | null = null;
  private raf = 0;
  private lastCue = 0;
  private opts: PlayerOptions;
  private ready: Promise<void>;
  private waiters: { phase: 'hold' | 'done'; resolve: () => void }[] = [];
  private audio = new Map<string, HTMLAudioElement>();

  constructor(host: HTMLElement, project: TitleProject | string, opts: PlayerOptions = {}) {
    const read = readProject(typeof project === 'string' ? (JSON.parse(project) as unknown) : project);
    if (!read.project) throw new Error(read.error ?? 'Not a Lumora title');
    this.project = read.project;
    this.opts = opts;
    this.env = browserEnv();
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    host.appendChild(this.canvas);
    const t = tokensFor(this.project, undefined);
    this.ready = Promise.all([this.env.prepare(this.project), requestFonts([t.font, t.fontSub])]).then(() => {});
    this.env.onReady(() => this.draw());
  }

  private now() {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  /** The composition drawn (the format closest to the picture's shape). */
  comp(): Composition {
    const [w, h] = this.size();
    const p = this.project;
    return pickFormat(p, w, h) ?? p.compositions.find((c) => c.id === p.main) ?? p.compositions[0]!;
  }

  private size(): [number, number] {
    const main = this.project.compositions.find((c) => c.id === this.project.main) ?? this.project.compositions[0]!;
    const w = this.opts.width ?? (this.canvas.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 0) || main.width);
    const h = this.opts.height ?? (this.canvas.clientHeight || (typeof innerHeight === 'number' ? innerHeight : 0) || main.height);
    return [w, h];
  }

  /** Fonts and pictures loaded, first values set. */
  async load(values?: Values): Promise<void> {
    if (values) this.values = { ...this.values, ...values };
    await this.ready;
    this.draw();
  }

  state(): PlayerState {
    if (this.inAt === null) return 'off';
    return this.at().phase;
  }

  /** Take the graphic: its IN, then HOLD. Resolves when the IN has played. */
  play(skipAnimation = false): Promise<void> {
    const now = this.now();
    const c = this.comp();
    if (this.inAt !== null && this.outAt === null) return Promise.resolve();
    this.inAt = skipAnimation ? now - c.markers.inEnd * 1000 : now;
    this.outAt = null;
    this.lastCue = this.inAt;
    this.loop();
    return this.until('hold');
  }

  /** Take it off: its OUT. Resolves when the OUT has played. */
  stop(skipAnimation = false): Promise<void> {
    if (this.inAt === null) return Promise.resolve();
    const now = this.now();
    if (this.outAt === null) this.outAt = skipAnimation ? now - 3600_000 : now;
    else if (skipAnimation) this.outAt = now - 3600_000;
    this.loop();
    return this.until('done');
  }

  /** New field values (all at once or only some); drawn straight away. */
  update(values: Values): void {
    this.values = { ...this.values, ...values };
    this.draw();
  }

  getValues(): Values {
    return { ...this.values };
  }

  /** Off at once, nothing drawn. */
  clear(): void {
    this.inAt = null;
    this.outAt = null;
    this.draw();
    this.settle();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const a of this.audio.values()) a.pause();
    this.canvas.remove();
  }

  private at(): { t: number; phase: Phase; clock: number } {
    const c = this.comp();
    const now = this.now();
    if (this.inAt === null) return { t: 0, phase: 'done', clock: 0 };
    const sinceIn = (now - this.inAt) / 1000;
    const r = cueTime(c, sinceIn, this.outAt === null ? null : (now - this.outAt) / 1000);
    return { ...r, clock: sinceIn };
  }

  private until(phase: 'hold' | 'done'): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push({ phase, resolve });
      this.settle();
    });
  }

  private settle() {
    const p = this.state();
    const reached = (want: 'hold' | 'done') => (want === 'done' ? p === 'done' || p === 'off' : p === 'hold' || p === 'out' || p === 'done' || p === 'off');
    this.waiters = this.waiters.filter((w) => {
      if (!reached(w.phase)) return true;
      w.resolve();
      return false;
    });
  }

  private loop() {
    if (this.opts.animate === false || this.raf || typeof requestAnimationFrame === 'undefined') {
      this.draw();
      return;
    }
    const tick = () => {
      this.raf = 0;
      this.draw();
      const p = this.state();
      if (p !== 'done' && p !== 'off') this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Draw the frame for now. */
  draw(): void {
    const [w, h] = this.size();
    const dpr = typeof devicePixelRatio === 'number' && !this.opts.width ? devicePixelRatio : 1;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pw, ph);
    }
    if (this.inAt !== null) {
      const r = this.at();
      if (r.phase !== 'done' && ctx) {
        const c = this.comp();
        renderFrame(ctx, this.project, { comp: c.id, time: r.t, clock: r.clock, values: this.values, env: this.env, width: pw, height: ph });
      }
      this.sounds();
    }
    this.settle();
  }

  /** Audio cues passed since the last frame. */
  private sounds() {
    if (this.opts.sound === false || this.inAt === null || typeof Audio === 'undefined') return;
    const now = this.now();
    const c = this.comp();
    const evs = cueEvents(this.project, c, this.inAt / 1000, this.outAt === null ? null : this.outAt / 1000, this.lastCue / 1000, now / 1000);
    this.lastCue = now;
    for (const e of evs) {
      if (now / 1000 - e.at > 0.25) continue;
      let a = this.audio.get(e.sound.id);
      if (!a) {
        a = new Audio(e.sound.src);
        this.audio.set(e.sound.id, a);
      }
      a.volume = Math.max(0, Math.min(1, 10 ** ((e.cue.gain ?? 0) / 20)));
      a.currentTime = 0;
      void a.play().catch(() => {});
    }
  }
}
