// Audio cues of Lumora Titler graphics on air: a cue marker with a sound
// plays it through the sound engine when the graphic reaches it (IN from the
// take, every time round a loop, OUT from taking it off), on the mixes the
// cue was set to (Stream, Hall, Recording). Sounds are scheduled a little
// ahead on the sound clock, so they land on their frame; Blank takes them
// down with the picture, and PANIC stops them at once.

import { cueEvents, cueGain, cueMixes } from '../../../titler/src/core/cues';
import type { Asset, CueMix } from '../../../titler/src/core/types';
import { faderToGain, type Mix } from '../engine/audio';
import { fadeAmount } from '../engine/timing';
import type { Show } from '../engine/types/Show';
import { projectOf } from './titlerSource';

export const CUE_MIX: Record<CueMix, Mix> = { stream: 'master', hall: 'a', recording: 'b' };

export interface DueCue {
  /** The same cue at the same moment has the same key (played once). */
  key: string;
  source: string;
  sound: Asset;
  /** When it plays, ms (Date.now() clock). */
  at: number;
  mixes: Mix[];
  gain: number;
}

/**
 * The cues of every Titler graphic in an overlay channel that play in
 * [from, to) ms. `inAt` remembers when each graphic last came on (so its OUT
 * is timed from the take that it ends). Nothing plays during PANIC.
 */
export function dueCues(show: Show, from: number, to: number, inAt: Map<string, number>): DueCue[] {
  if (show.panic) return [];
  const out: DueCue[] = [];
  for (const o of show.overlays) {
    if (!o.sourceId || !o.screens.length) continue;
    const src = show.sources.find((s) => s.id === o.sourceId);
    if (src?.kind.type !== 'titler') continue;
    const p = projectOf(src.kind);
    const c = p?.compositions.find((x) => x.id === p.main) ?? p?.compositions[0];
    if (!p || !c || !c.cues.length) continue;
    if (o.on) inAt.set(src.id, o.changedAt);
    const taken = o.on ? o.changedAt : (inAt.get(src.id) ?? o.changedAt - 3_600_000);
    const off = o.on ? null : o.changedAt / 1000;
    for (const e of cueEvents(p, c, taken / 1000, off, from / 1000, to / 1000)) {
      const mixes = cueMixes(e.cue).map((m) => CUE_MIX[m]);
      if (!mixes.length) continue;
      const at = e.at * 1000;
      out.push({ key: `${src.id}|${e.cue.id}|${Math.round(at)}`, source: src.id, sound: e.sound, at, mixes, gain: cueGain(e.cue) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** How loud the cues are on a mix now: the mix's own level and mute, under Blank and PANIC (0–1). */
export function cueBusLevel(show: Show, mix: Mix, now: number): number {
  const live = show.screens.live;
  const down = 1 - Math.max(fadeAmount(live.blank, live.blankChangedAt, now, live.blankFadeMs), fadeAmount(show.panic, show.panicChangedAt, now));
  const level =
    mix === 'master' ? (show.audio.masterMuted ? 0 : faderToGain(show.masterVolume)) : show.audio[mix].muted ? 0 : faderToGain(show.audio[mix].volume);
  return Math.max(0, level * down);
}

/** The bits of Web Audio the cue player uses (a test passes its own). */
export interface CueAudio {
  readonly currentTime: number;
  createBufferSource(): AudioBufferSourceNode;
  createGain(): GainNode;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

/** Looked ahead each tick (the sound engine ticks every 33 ms). */
export const LOOK_AHEAD_MS = 250;
/** A cue noticed late (the show arrived after its moment) still plays, from where it should be, up to this late. */
export const LATE_MS = 400;

interface Playing {
  node: AudioBufferSourceNode;
  gain: GainNode;
  when: number;
  ends: number;
}

/** Plays Titler cues into the sound engine's mixes. */
export class TitlerCuePlayer {
  private readonly inAt = new Map<string, number>();
  private readonly buffers = new Map<string, AudioBuffer | null | 'loading'>();
  private readonly playing = new Map<string, Playing>();
  private readonly done = new Map<string, number>();
  readonly buses: Record<Mix, GainNode>;

  constructor(
    private readonly ctx: CueAudio,
    into: Record<Mix, AudioNode>,
    private readonly load: (src: string) => Promise<ArrayBuffer>,
  ) {
    const bus = (mix: Mix) => {
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(into[mix]);
      return g;
    };
    this.buses = { master: bus('master'), a: bus('a'), b: bus('b') };
  }

  private buffer(a: Asset): AudioBuffer | null {
    const key = `${a.id}|${a.src.length}|${a.src.slice(0, 120)}`;
    const got = this.buffers.get(key);
    if (got === undefined) {
      this.buffers.set(key, 'loading');
      void this.load(a.src)
        .then((b) => this.ctx.decodeAudioData(b))
        .then(
          (b) => this.buffers.set(key, b),
          () => this.buffers.set(key, null),
        );
      return null;
    }
    return got === 'loading' ? null : got;
  }

  /** Schedule what is due soon; stop what should no longer play. `now` is Date.now(). */
  tick(show: Show, now: number): void {
    const t = this.ctx.currentTime;
    for (const mix of ['master', 'a', 'b'] as const) {
      const v = cueBusLevel(show, mix, now);
      const g = this.buses[mix].gain;
      if (Math.abs(g.value - v) > 1e-4) g.setTargetAtTime(v, t, 0.012);
    }
    if (show.panic) {
      this.stopAll();
      return;
    }
    const due = dueCues(show, now - LATE_MS, now + LOOK_AHEAD_MS, this.inAt);
    const keys = new Set(due.map((d) => d.key));
    // Taken off (or changed) before a scheduled cue began: it does not play.
    for (const [key, p] of this.playing) {
      if (p.when > t + 0.005 && !keys.has(key)) {
        this.stop(key, p);
        this.done.delete(key);
      } else if (p.ends < t) this.playing.delete(key);
    }
    for (const d of due) {
      if (this.done.has(d.key)) continue;
      const buf = this.buffer(d.sound);
      if (!buf) continue;
      const when = t + (d.at - now) / 1000;
      const late = Math.max(0, t - when);
      if (late >= buf.duration) {
        this.done.set(d.key, d.at);
        continue;
      }
      const node = this.ctx.createBufferSource();
      node.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = d.gain;
      node.connect(gain);
      for (const m of d.mixes) gain.connect(this.buses[m]);
      node.start(Math.max(t, when), late);
      this.playing.set(d.key, { node, gain, when: Math.max(t, when), ends: Math.max(t, when) + buf.duration - late });
      this.done.set(d.key, d.at);
    }
    for (const [k, at] of this.done) if (at < now - 10_000) this.done.delete(k);
  }

  private stop(key: string, p: Playing) {
    try {
      p.node.stop();
    } catch {
      // Not started.
    }
    p.node.disconnect();
    p.gain.disconnect();
    this.playing.delete(key);
  }

  /** PANIC: every cue sound stops now. */
  stopAll(): void {
    for (const [k, p] of this.playing) this.stop(k, p);
  }

  /** How many cue sounds are scheduled or playing (tests, the meters). */
  get active(): number {
    return this.playing.size;
  }
}
