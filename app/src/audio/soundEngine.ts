// The sound engine. It runs in the control window only (output windows are
// silent), so every sound is played exactly once:
//
//   source → delay → filters (low cut, EQ, gate, compressor) → fader ─┬→ send → Stream mix → limiter → speakers
//                           ├→ send → Hall mix   → chosen device
//                           ├→ send → Recording  → chosen device
//                           └→ meter
//   source → delay → solo (pre-fader) → Headphones → chosen device
//
// Levels come from engine/audio.ts, recalculated 30 times a second so sound
// fades smoothly with transitions, the T-bar, Blank and PANIC.

import type { EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { channelLevel, defaultFilters, DUCK_HOLD_MS, duckGain, duckStep, mixSend, soundSources, type Mix } from '../engine/audio';
import { syncMedia } from '../engine/mediaSync';
import { PcmStream } from './pcmStream';

type OutputName = Mix | 'phones';

interface Channel {
  key: string;
  el: HTMLAudioElement | null;
  stream: MediaStream | null;
  pcm: PcmStream | null;
  input: AudioNode | null;
  delay: DelayNode;
  lowCut: BiquadFilterNode;
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
  /** Measures the sound before the gate, to open and close it. */
  gateMeter: AnalyserNode;
  gate: GainNode;
  comp: DynamicsCompressorNode;
  fader: GainNode;
  meter: AnalyserNode;
  sends: Record<Mix, GainNode>;
  solo: GainNode;
  failed: boolean;
}

interface Output {
  /** Channels send into this; it goes through the limiter to `gain`. */
  input: GainNode;
  gain: GainNode;
  meter: AnalyserNode;
  /** Plays the mix on a chosen device (Hall, Recording, Headphones). */
  player: HTMLAudioElement | null;
  device: string | null | undefined;
}

/** Can this browser send sound to a chosen device? (Windows yes; the Linux preview no.) */
export function canChooseSpeakers(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/** How often a microphone that dropped out is tried again. */
const MIC_RETRY_MS = 3000;

const channelKey = (s: Source) =>
  s.kind.type === 'stream'
    ? `stream:${s.kind.url}`
    : s.kind.type === 'browser' || s.kind.type === 'guest'
      ? `page:${s.id}`
      : s.kind.type === 'video'
        ? `file:${s.kind.path}`
        : s.kind.type === 'microphone'
          ? // Noise removal is set when the microphone opens.
            `mic:${s.kind.deviceId}:${s.audio.filters?.noiseSuppression ? 'ns' : ''}`
          : '';

function peak(a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  a.getFloatTimeDomainData(buf);
  let p = 0;
  for (const v of buf) p = Math.max(p, Math.abs(v));
  return Math.min(1, p);
}

export class SoundEngine {
  private readonly ctx: AudioContext;
  private readonly channels = new Map<string, Channel>();
  private readonly outputs: Record<OutputName, Output>;
  private readonly phonesFromStream: GainNode;
  private readonly buf = new Float32Array(512);
  private readonly timer: ReturnType<typeof setInterval>;
  private show: Show | null = null;
  /** Latest peak level (0–1) per channel id, and per mix as `mix:<name>`. */
  readonly levels = new Map<string, number>();
  /** Channels whose device or file could not be opened. */
  readonly problems = new Set<string>();

  constructor(private readonly client: EngineClient) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const make = (name: OutputName): Output => {
      // A limiter on every mix: nothing ever clips, whatever is pushed up.
      const input = this.ctx.createGain();
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.5;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      input.connect(limiter);
      const gain = this.ctx.createGain();
      limiter.connect(gain);
      const meter = this.ctx.createAnalyser();
      meter.fftSize = 512;
      gain.connect(meter);
      if (name === 'master') gain.connect(this.ctx.destination);
      return { input, gain, meter, player: null, device: undefined };
    };
    this.outputs = { master: make('master'), a: make('a'), b: make('b'), phones: make('phones') };
    // With nothing soloed, the headphones hear the Stream mix.
    this.phonesFromStream = this.ctx.createGain();
    this.outputs.master.gain.connect(this.phonesFromStream);
    this.phonesFromStream.connect(this.outputs.phones.input);
    this.timer = setInterval(() => this.tick(), 33);
    // Browsers only start sound after the operator touches something.
    const wake = () => void this.ctx.resume().catch(() => {});
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    this.unwake = () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }

  private readonly unwake: () => void;

  /** Browsers hold sound back until the operator first clicks or types. */
  get waitingForClick(): boolean {
    return this.ctx.state !== 'running';
  }

  private readonly taps = new Map<MediaStream, { mix: 'master' | 'b'; node: MediaStreamAudioDestinationNode }>();

  /**
   * A mix as a live sound track, for recording and streaming. It carries
   * the mix exactly as heard (faders, mutes, audio-follows-video fades).
   */
  mixStream(mix: 'master' | 'b'): MediaStream {
    const node = this.ctx.createMediaStreamDestination();
    node.channelCount = 2;
    this.outputs[mix].gain.connect(node);
    this.taps.set(node.stream, { mix, node });
    void this.ctx.resume().catch(() => {});
    return node.stream;
  }

  /** Who listens to what (live captions): a channel after its fader, or the Stream mix (null). */
  private readonly listeners = new Map<AudioNode, { id: string | null; pre: boolean }>();

  /** The sound clock (for things that listen, like live captions). */
  get context(): AudioContext {
    return this.ctx;
  }

  /**
   * Feed a channel (after its fader, so a closed microphone is silent; or
   * `pre`: before it, as the microphone hears, for its own recording) or the
   * Stream mix (null) into `into`. Survives the channel being reopened.
   * Returns a function that stops it.
   */
  listen(sourceId: string | null, into: AudioNode, pre = false): () => void {
    this.listeners.set(into, { id: sourceId, pre });
    const tap = (ch: Channel | undefined) => (pre ? ch?.comp : ch?.fader);
    const from = sourceId === null ? this.outputs.master.gain : tap(this.channels.get(sourceId));
    from?.connect(into);
    void this.ctx.resume().catch(() => {});
    return () => {
      this.listeners.delete(into);
      const now = sourceId === null ? this.outputs.master.gain : tap(this.channels.get(sourceId));
      try {
        now?.disconnect(into);
      } catch {
        // Already gone.
      }
    };
  }

  /** Stop feeding a stream made by {@link mixStream}. */
  endMixStream(stream: MediaStream): void {
    const tap = this.taps.get(stream);
    if (!tap) return;
    this.taps.delete(stream);
    stream.getTracks().forEach((t) => t.stop());
    this.outputs[tap.mix].gain.disconnect(tap.node);
  }

  /** Give the engine the latest show. */
  setShow(show: Show): void {
    this.show = show;
    this.reconcile(show);
    void this.route(show);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.unwake();
    for (const id of [...this.channels.keys()]) this.drop(id);
    for (const o of Object.values(this.outputs)) {
      o.player?.pause();
    }
    void this.ctx.close().catch(() => {});
  }

  // ---- channels ----

  private reconcile(show: Show) {
    const wanted = new Map(soundSources(show).map((s) => [s.id, s]));
    for (const id of [...this.channels.keys()]) {
      const src = wanted.get(id);
      if (!src || channelKey(src) !== this.channels.get(id)!.key) this.drop(id);
    }
    for (const [id, src] of wanted) if (!this.channels.has(id)) this.add(src);
  }

  private add(src: Source) {
    const ctx = this.ctx;
    const delay = ctx.createDelay(5);
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.value = 10;
    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 120;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 0.8;
    const treble = ctx.createBiquadFilter();
    treble.type = 'highshelf';
    treble.frequency.value = 8000;
    const gateMeter = ctx.createAnalyser();
    gateMeter.fftSize = 512;
    const gate = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    const fader = ctx.createGain();
    const meter = ctx.createAnalyser();
    meter.fftSize = 512;
    const solo = ctx.createGain();
    fader.gain.value = 0;
    solo.gain.value = 0;
    delay.connect(lowCut);
    lowCut.connect(bass);
    bass.connect(mid);
    mid.connect(treble);
    treble.connect(gateMeter);
    treble.connect(gate);
    gate.connect(comp);
    comp.connect(fader);
    comp.connect(solo);
    this.setFilters({ lowCut, bass, mid, treble, comp }, src);
    fader.connect(meter);
    for (const [into, l] of this.listeners) if (l.id === src.id) (l.pre ? comp : fader).connect(into);
    solo.connect(this.outputs.phones.input);
    const sends = {} as Record<Mix, GainNode>;
    for (const mix of ['master', 'a', 'b'] as const) {
      const g = ctx.createGain();
      g.gain.value = 0;
      fader.connect(g);
      g.connect(this.outputs[mix].input);
      sends[mix] = g;
    }
    const ch: Channel = {
      key: channelKey(src),
      el: null,
      stream: null,
      pcm: null,
      input: null,
      delay,
      lowCut,
      bass,
      mid,
      treble,
      gateMeter,
      gate,
      comp,
      fader,
      meter,
      sends,
      solo,
      failed: false,
    };
    this.channels.set(src.id, ch);

    if (src.kind.type === 'video') {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.src = this.client.mediaUrl(src.kind.path);
      el.onerror = () => {
        ch.failed = true;
        this.problems.add(src.id);
      };
      ch.el = el;
      try {
        ch.input = ctx.createMediaElementSource(el);
        ch.input.connect(delay);
      } catch {
        ch.failed = true;
        this.problems.add(src.id);
      }
    } else if (src.kind.type === 'stream' || src.kind.type === 'browser' || src.kind.type === 'guest') {
      // The app serves the sound of streams, web pages and guests next to their pictures.
      const id = src.id;
      const url = () => this.client.browserInfo().then((i) => (i.port ? `http://127.0.0.1:${i.port}/audio/${encodeURIComponent(id)}` : null));
      ch.pcm = new PcmStream(ctx, url, delay);
    } else if (src.kind.type === 'microphone') {
      const deviceId = src.kind.deviceId;
      navigator.mediaDevices
        ?.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: !!src.audio.filters?.noiseSuppression,
            autoGainControl: false,
          },
        })
        .then((stream) => {
          if (this.channels.get(src.id) !== ch) return stream.getTracks().forEach((t) => t.stop());
          this.problems.delete(src.id);
          ch.stream = stream;
          ch.input = ctx.createMediaStreamSource(stream);
          ch.input.connect(delay);
          stream.getAudioTracks().forEach((t) =>
            t.addEventListener('ended', () => {
              ch.failed = true;
              this.problems.add(src.id);
            }),
          );
        })
        .catch(() => {
          ch.failed = true;
          this.problems.add(src.id);
        });
    }
  }

  private drop(id: string) {
    const ch = this.channels.get(id);
    if (!ch) return;
    this.channels.delete(id);
    this.problems.delete(id);
    this.levels.delete(id);
    ch.el?.pause();
    if (ch.el) ch.el.src = '';
    ch.stream?.getTracks().forEach((t) => t.stop());
    ch.pcm?.stop();
    for (const n of [
      ch.input,
      ch.delay,
      ch.lowCut,
      ch.bass,
      ch.mid,
      ch.treble,
      ch.gateMeter,
      ch.gate,
      ch.comp,
      ch.fader,
      ch.meter,
      ch.solo,
      ...Object.values(ch.sends),
    ])
      n?.disconnect();
  }

  /** Set EQ, low cut and compressor from the input's settings. */
  private setFilters(n: Pick<Channel, 'lowCut' | 'bass' | 'mid' | 'treble' | 'comp'>, src: Source) {
    const f = src.audio.filters ?? defaultFilters();
    const t = this.ctx.currentTime;
    n.lowCut.frequency.setTargetAtTime(f.lowCut ? 100 : 10, t, 0.02);
    n.bass.gain.setTargetAtTime(f.bassDb, t, 0.02);
    n.mid.gain.setTargetAtTime(f.midDb, t, 0.02);
    n.treble.gain.setTargetAtTime(f.trebleDb, t, 0.02);
    // Voice compression when on; otherwise it lets everything through.
    n.comp.threshold.setTargetAtTime(f.compressor ? -24 : 0, t, 0.02);
    n.comp.ratio.setTargetAtTime(f.compressor ? 4 : 1, t, 0.02);
    n.comp.knee.value = f.compressor ? 10 : 0;
    n.comp.attack.value = 0.005;
    n.comp.release.value = 0.2;
  }

  // ---- speakers ----

  private async route(show: Show) {
    const want: Record<OutputName, string | null> = {
      master: show.settings.audioOutputs.master,
      a: show.settings.audioOutputs.a,
      b: show.settings.audioOutputs.b,
      phones: show.settings.audioOutputs.headphones,
    };
    for (const name of ['master', 'a', 'b', 'phones'] as const) {
      const o = this.outputs[name];
      if (o.device === want[name]) continue;
      o.device = want[name];
      if (name === 'master') {
        // The Stream mix plays through the context itself.
        const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
        if (ctx.setSinkId) await ctx.setSinkId(want.master ?? '').catch(() => {});
        continue;
      }
      if (want[name] === null || !canChooseSpeakers()) {
        o.player?.pause();
        o.player = null;
        continue;
      }
      if (!o.player) {
        const dest = this.ctx.createMediaStreamDestination();
        o.gain.connect(dest);
        o.player = new Audio();
        o.player.srcObject = dest.stream;
      }
      const player = o.player as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> };
      await player.setSinkId(want[name]!).catch(() => {});
      void player.play().catch(() => {});
    }
  }

  // ---- every 33 ms ----

  /** How far music is ducked now (1: not at all, 0: fully), eased in and out. */
  private ducked = 0;
  /** When a microphone last had someone talking. */
  private talkedAt = 0;

  /** The gain for a channel that ducks by `db` while someone talks. */
  private duckGain(db: number): number {
    return duckGain(db, this.ducked);
  }

  /** Is anyone talking into a microphone (after its fader, so a closed mic never ducks)? */
  private updateTalking(show: Show, now: number) {
    let loud = false;
    for (const src of soundSources(show)) {
      if (src.kind.type !== 'microphone') continue;
      const lv = this.levels.get(src.id) ?? 0;
      if (lv > 0.03) loud = true; // about −30 dB
    }
    if (loud) this.talkedAt = now;
    this.ducked = duckStep(this.ducked, now - this.talkedAt < DUCK_HOLD_MS);
  }

  /** When dropped-out microphones were last tried again. */
  private micsTriedAt = 0;

  /**
   * A microphone that dropped out (unplugged, a wireless receiver's USB
   * hiccup, Windows resetting the sound device) is opened again every few
   * seconds, so it comes back by itself instead of staying silent.
   */
  private reopenMicrophones(show: Show, now: number) {
    if (now - this.micsTriedAt < MIC_RETRY_MS) return;
    this.micsTriedAt = now;
    for (const src of soundSources(show)) {
      if (src.kind.type !== 'microphone' || !this.channels.get(src.id)?.failed) continue;
      this.drop(src.id);
      this.add(src);
      // Still a problem until it really opens.
      this.problems.add(src.id);
    }
  }

  private tick() {
    const show = this.show;
    if (!show) return;
    this.updateTalking(show, Date.now());
    const now = Date.now();
    const t = this.ctx.currentTime;
    const smooth = 0.012;
    const solo = show.audio.solo;
    this.phonesFromStream.gain.setTargetAtTime(solo === null ? 1 : 0, t, smooth);
    this.reopenMicrophones(show, now);
    for (const src of soundSources(show)) {
      const ch = this.channels.get(src.id);
      if (!ch) continue;
      if (ch.el) syncMedia(ch.el, src, now);
      ch.delay.delayTime.setTargetAtTime(src.audio.delayMs / 1000, t, 0.05);
      this.setFilters(ch, src);
      // The gate opens fast on sound and closes gently below the threshold.
      const f = src.audio.filters;
      if (f?.gate) {
        const level = peak(ch.gateMeter, this.buf);
        const open = level > 0 && 20 * Math.log10(level) > f.gateDb;
        ch.gate.gain.setTargetAtTime(open ? 1 : 0, t, open ? 0.003 : 0.08);
      } else ch.gate.gain.setTargetAtTime(1, t, 0.01);
      const duck = src.audio.filters?.duck ? this.duckGain(src.audio.filters.duckDb) : 1;
      ch.fader.gain.setTargetAtTime(channelLevel(show, src, now) * duck, t, smooth);
      for (const mix of ['master', 'a', 'b'] as const) ch.sends[mix].gain.setTargetAtTime(mixSend(show, src, mix), t, smooth);
      ch.solo.gain.setTargetAtTime(solo === src.id ? 1 : 0, t, smooth);
      this.levels.set(src.id, ch.failed ? 0 : peak(ch.meter, this.buf));
    }
    for (const name of ['master', 'a', 'b', 'phones'] as const) {
      this.levels.set(`mix:${name}`, peak(this.outputs[name].meter, this.buf));
    }
  }
}
