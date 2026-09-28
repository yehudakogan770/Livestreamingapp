// The sound engine. It runs in the control window only (output windows are
// silent), so every sound is played exactly once:
//
//   source → delay → fader ─┬→ send → Stream mix → speakers (or chosen device)
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
import { channelLevel, mixSend, soundSources, type Mix } from '../engine/audio';
import { syncMedia } from '../engine/mediaSync';

type OutputName = Mix | 'phones';

interface Channel {
  key: string;
  el: HTMLAudioElement | null;
  stream: MediaStream | null;
  input: AudioNode | null;
  delay: DelayNode;
  fader: GainNode;
  meter: AnalyserNode;
  sends: Record<Mix, GainNode>;
  solo: GainNode;
  failed: boolean;
}

interface Output {
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

const channelKey = (s: Source) =>
  s.kind.type === 'video' ? `file:${s.kind.path}` : s.kind.type === 'microphone' ? `mic:${s.kind.deviceId}` : '';

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
      const gain = this.ctx.createGain();
      const meter = this.ctx.createAnalyser();
      meter.fftSize = 512;
      gain.connect(meter);
      if (name === 'master') gain.connect(this.ctx.destination);
      return { gain, meter, player: null, device: undefined };
    };
    this.outputs = { master: make('master'), a: make('a'), b: make('b'), phones: make('phones') };
    // With nothing soloed, the headphones hear the Stream mix.
    this.phonesFromStream = this.ctx.createGain();
    this.outputs.master.gain.connect(this.phonesFromStream);
    this.phonesFromStream.connect(this.outputs.phones.gain);
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
    const fader = ctx.createGain();
    const meter = ctx.createAnalyser();
    meter.fftSize = 512;
    const solo = ctx.createGain();
    fader.gain.value = 0;
    solo.gain.value = 0;
    delay.connect(fader);
    delay.connect(solo);
    fader.connect(meter);
    solo.connect(this.outputs.phones.gain);
    const sends = {} as Record<Mix, GainNode>;
    for (const mix of ['master', 'a', 'b'] as const) {
      const g = ctx.createGain();
      g.gain.value = 0;
      fader.connect(g);
      g.connect(this.outputs[mix].gain);
      sends[mix] = g;
    }
    const ch: Channel = { key: channelKey(src), el: null, stream: null, input: null, delay, fader, meter, sends, solo, failed: false };
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
    } else if (src.kind.type === 'microphone') {
      const deviceId = src.kind.deviceId;
      navigator.mediaDevices
        ?.getUserMedia({
          audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        .then((stream) => {
          if (this.channels.get(src.id) !== ch) return stream.getTracks().forEach((t) => t.stop());
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
    for (const n of [ch.input, ch.delay, ch.fader, ch.meter, ch.solo, ...Object.values(ch.sends)]) n?.disconnect();
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

  private tick() {
    const show = this.show;
    if (!show) return;
    const now = Date.now();
    const t = this.ctx.currentTime;
    const smooth = 0.012;
    const solo = show.audio.solo;
    this.phonesFromStream.gain.setTargetAtTime(solo === null ? 1 : 0, t, smooth);
    for (const src of soundSources(show)) {
      const ch = this.channels.get(src.id);
      if (!ch) continue;
      if (ch.el) syncMedia(ch.el, src, now);
      ch.delay.delayTime.setTargetAtTime(src.audio.delayMs / 1000, t, 0.05);
      ch.fader.gain.setTargetAtTime(channelLevel(show, src, now), t, smooth);
      for (const mix of ['master', 'a', 'b'] as const) ch.sends[mix].gain.setTargetAtTime(mixSend(show, src, mix), t, smooth);
      ch.solo.gain.setTargetAtTime(solo === src.id ? 1 : 0, t, smooth);
      this.levels.set(src.id, ch.failed ? 0 : peak(ch.meter, this.buf));
    }
    for (const name of ['master', 'a', 'b', 'phones'] as const) {
      this.levels.set(`mix:${name}`, peak(this.outputs[name].meter, this.buf));
    }
  }
}
