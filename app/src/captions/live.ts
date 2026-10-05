// Live captions, in the control window: listens to a microphone (or the
// Stream mix), cuts the sound into phrases, has the speech model write them
// down (in a worker), and sends the words to the stream: to YouTube as
// closed captions viewers turn on and off, and to the stream picture if
// asked. Nothing here may disturb the show: if anything fails, captions stop
// and the operator is told.

import type { CaptureSettings, CaptureStatus, EngineClient } from '../engine/client';
import type { Captions } from '../engine/types/Captions';
import type { SoundEngine } from '../audio/soundEngine';
import { CaptionLines } from './lines';
import { to16k } from './moonshine';
import { Segmenter } from './segmenter';

export type CaptionState = { state: 'off' } | { state: 'downloading' } | { state: 'starting' } | { state: 'listening' } | { state: 'failed'; message: string };

const MODEL = 'moonshine-tiny';
const FILES = { encoder: 'encoder_model_quantized.onnx', decoder: 'decoder_model_merged_quantized.onnx', tokenizer: 'tokenizer.json' };

export class LiveCaptions {
  readonly lines = new CaptionLines();
  private worker: Worker | null = null;
  private stopListening: (() => void) | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silent: GainNode | null = null;
  private segmenter = new Segmenter();
  private busy = false;
  private waiting: Float32Array | null = null;
  private nextId = 1;
  private finals = new Set<number>();
  private seq = 1;
  private state: CaptionState = { state: 'off' };
  private run = 0;
  /** Where finished phrases go (YouTube caption addresses), read when sending. */
  sendTo: () => string[] = () => [];
  onState: (s: CaptionState) => void = () => {};

  constructor(
    private readonly client: EngineClient,
    private readonly sound: SoundEngine,
  ) {}

  get status(): CaptionState {
    return this.state;
  }

  private set(s: CaptionState) {
    this.state = s;
    this.onState(s);
  }

  /** Start listening to `listen` (a microphone input, or null: the Stream mix). */
  async start(listen: string | null): Promise<void> {
    this.stop();
    const run = ++this.run;
    try {
      this.set({ state: 'downloading' });
      const folder = await this.client.captionsModel(MODEL);
      if (run !== this.run) return;
      this.set({ state: 'starting' });
      const sep = folder.includes('\\') ? '\\' : '/';
      const url = (f: string) => this.client.mediaUrl(`${folder}${sep}${f}`);
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<{ type: string; message?: string }>) =>
          e.data.type === 'ready' ? resolve() : reject(new Error(e.data.message ?? 'The speech model could not start.'));
        worker.onerror = (e) => reject(new Error(e.message || 'The speech model could not start.'));
        worker.postMessage({
          type: 'load',
          ortBase: new URL('ort/', document.baseURI).href,
          encoder: url(FILES.encoder),
          decoder: url(FILES.decoder),
          tokenizer: url(FILES.tokenizer),
        });
      });
      if (run !== this.run) return;
      worker.onmessage = (e: MessageEvent<{ type: string; id: number; text: string }>) => this.heard(e.data.id, e.data.text);
      worker.onerror = () => this.fail('The speech model stopped.');
      // Listen: the sound comes in 4096 samples at a time.
      const ctx = this.sound.context;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      processor.connect(silent);
      silent.connect(ctx.destination);
      processor.onaudioprocess = (e) => this.take(to16k(e.inputBuffer.getChannelData(0).slice(), ctx.sampleRate));
      this.processor = processor;
      this.silent = silent;
      this.stopListening = this.sound.listen(listen, processor);
      this.set({ state: 'listening' });
    } catch (e) {
      if (run === this.run) this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  stop(): void {
    this.run++;
    this.stopListening?.();
    this.stopListening = null;
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.silent?.disconnect();
    this.processor = null;
    this.silent = null;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.waiting = null;
    this.segmenter = new Segmenter();
    if (this.state.state !== 'failed') this.set({ state: 'off' });
  }

  private fail(message: string) {
    this.stop();
    this.set({ state: 'failed', message });
  }

  private take(audio16k: Float32Array) {
    for (const p of this.segmenter.push(audio16k)) {
      if (p.kind === 'final') this.ask(p.audio, true);
      // Words so far: only when the model is free (finished phrases come first).
      else if (!this.busy) this.ask(p.audio, false);
    }
  }

  private ask(audio: Float32Array, final: boolean) {
    if (!this.worker) return;
    if (this.busy) {
      // One finished phrase waits its turn; partials are dropped.
      if (final) this.waiting = audio;
      return;
    }
    const id = this.nextId++;
    if (final) this.finals.add(id);
    this.busy = true;
    this.worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  }

  private heard(id: number, text: string) {
    this.busy = false;
    const final = this.finals.delete(id);
    if (final) {
      this.lines.addFinal(text);
      if (text.trim()) for (const url of this.sendTo()) void this.client.captionsSend(url, this.seq++, Date.now(), text).catch(() => {});
    } else this.lines.setPartial(text);
    const next = this.waiting;
    this.waiting = null;
    if (next) this.ask(next, true);
  }
}

/** The YouTube caption addresses to send to now (only while streaming there). */
export function captionTargets(settings: CaptureSettings, status: CaptureStatus): string[] {
  if (!status.streaming && !status.vertical) return [];
  return settings.destinations.filter((d) => d.enabled && (d.captionsUrl ?? '').trim().startsWith('https://')).map((d) => d.captionsUrl!.trim());
}

/** Captions are wanted and set up to go somewhere. */
export const captionsWanted = (c: Captions | undefined) => !!c?.on;
