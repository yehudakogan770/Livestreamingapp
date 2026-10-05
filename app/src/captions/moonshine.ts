// Speech to text, offline: the Moonshine model (English, made for live
// captions) run by ONNX Runtime on the operator's computer. Give it a few
// seconds of speech at 16 kHz; it gives back the words.

import type * as Ort from 'onnxruntime-web';

/** Turns the model's word pieces back into text (the tokenizer, reading only). */
export class Words {
  private readonly pieces: string[] = [];

  constructor(tokenizer: { model: { vocab: Record<string, number> }; added_tokens?: { id: number; content: string }[] }) {
    for (const [piece, id] of Object.entries(tokenizer.model.vocab)) this.pieces[id] = piece;
    for (const t of tokenizer.added_tokens ?? []) this.pieces[t.id] = t.content;
  }

  /** The text for some pieces (special ones like <s> are left out). */
  text(ids: number[]): string {
    const bytes: number[] = [];
    let out = '';
    const flush = () => {
      if (bytes.length) out += new TextDecoder().decode(new Uint8Array(bytes.splice(0)));
    };
    for (const id of ids) {
      const p = this.pieces[id];
      if (p === undefined || (p.startsWith('<') && p.endsWith('>') && !/^<0x[0-9A-F]{2}>$/.test(p))) continue;
      const byte = /^<0x([0-9A-F]{2})>$/.exec(p);
      if (byte) {
        bytes.push(parseInt(byte[1]!, 16));
        continue;
      }
      flush();
      out += p.replace(/▁/g, ' ');
    }
    flush();
    return out.replace(/^ /, '');
  }
}

export interface Files {
  encoder: Uint8Array | string;
  decoder: Uint8Array | string;
  tokenizer: ConstructorParameters<typeof Words>[0];
}

const LAYERS = 6;
const HEADS = 8;
const HEAD_DIM = 36;
const START = 1;
const END = 2;

export class Moonshine {
  private constructor(
    private readonly ort: typeof Ort,
    private readonly encoder: Ort.InferenceSession,
    private readonly decoder: Ort.InferenceSession,
    private readonly words: Words,
  ) {}

  static async load(ort: typeof Ort, files: Files): Promise<Moonshine> {
    const opts: Ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const make = (m: Uint8Array | string) => (typeof m === 'string' ? ort.InferenceSession.create(m, opts) : ort.InferenceSession.create(m, opts));
    const [encoder, decoder] = await Promise.all([make(files.encoder), make(files.decoder)]);
    return new Moonshine(ort, encoder, decoder, new Words(files.tokenizer));
  }

  /** The words in `audio` (16 kHz, −1 – 1). */
  async transcribe(audio: Float32Array): Promise<string> {
    const { ort } = this;
    if (audio.length < 1600) return '';
    audio = evenLevel(audio);
    const enc = await this.encoder.run({ input_values: new ort.Tensor('float32', audio, [1, audio.length]) });
    const hidden = enc.last_hidden_state!;
    // About 6.5 word pieces a second of speech, at most.
    const most = Math.ceil((audio.length / 16000) * 6.5) + 4;
    const empty = () => new ort.Tensor('float32', new Float32Array(0), [1, HEADS, 0, HEAD_DIM]);
    const past: Record<string, Ort.Tensor> = {};
    for (let i = 0; i < LAYERS; i++)
      for (const part of ['decoder', 'encoder']) for (const kv of ['key', 'value']) past[`past_key_values.${i}.${part}.${kv}`] = empty();
    const ids: number[] = [];
    let next = START;
    for (let step = 0; step < most; step++) {
      const out = await this.decoder.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from([BigInt(next)]), [1, 1]),
        encoder_hidden_states: hidden,
        use_cache_branch: new ort.Tensor('bool', [step > 0], [1]),
        ...past,
      });
      const logits = out.logits!.data as Float32Array;
      const vocab = out.logits!.dims[2]!;
      const last = logits.subarray(logits.length - vocab);
      let best = step === 0 ? 3 : 0;
      // It may not stop before saying anything (it tends to give up early on quiet speech).
      for (let i = 1; i < vocab; i++) if ((step > 0 || i !== END) && last[i]! > last[best]!) best = i;
      for (let i = 0; i < LAYERS; i++)
        for (const part of ['decoder', 'encoder'])
          for (const kv of ['key', 'value']) {
            const name = `${i}.${part}.${kv}`;
            // The encoder part is worked out once, on the first step.
            if (part === 'decoder' || step === 0) past[`past_key_values.${name}`] = out[`present.${name}`]!;
          }
      if (best === END) break;
      ids.push(best);
      next = best;
    }
    return this.words.text(ids).trim();
  }
}

/** Sound at any rate made into 16 kHz (what the model hears). */
export function to16k(input: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return input;
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average over the span (a simple low-pass, so it doesn't sound gritty).
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j]!;
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

/** Quiet speech brought up to a steady level (the model hears loud and quiet speakers alike); noise isn't boosted past 20×. */
export function evenLevel(audio: Float32Array): Float32Array {
  let peak = 0;
  for (const v of audio) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-4) return audio;
  const gain = Math.min(20, 0.9 / peak);
  if (Math.abs(gain - 1) < 0.05) return audio;
  return audio.map((v) => v * gain);
}
