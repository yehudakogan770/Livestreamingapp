// Speech to text in about 100 languages, offline: OpenAI's Whisper model
// (multilingual) run by ONNX Runtime on the operator's computer. Slower than
// Moonshine (English only), so it is used for every other language.

import type * as Ort from 'onnxruntime-web';

const RATE = 16000;
const N_FFT = 400;
const HOP = 160;
const MELS = 80;
const FRAMES = 3000; // 30 s
const LAYERS = 6;
const HEADS = 8;
const HEAD_DIM = 64;
const SOT = 50258;
const EOT = 50257;
const TRANSCRIBE = 50359;
const TRANSLATE = 50358;
const NO_TIMESTAMPS = 50363;
const FIRST_LANG = 50259;
const LAST_LANG = 50357;

// ---------------------------------------------------------------------------
// Sound to the picture of it the model reads (a log-mel spectrogram).

const hz2mel = (f: number) => (f < 1000 ? (3 * f) / 200 : 15 + (27 * Math.log(f / 1000)) / Math.log(6.4));
const mel2hz = (m: number) => (m < 15 ? (200 * m) / 3 : 1000 * Math.exp(((m - 15) * Math.log(6.4)) / 27));

/** The 80 mel filters over the 201 frequency bins (Slaney scale and norm, as Whisper was trained). */
function melFilters(): Float32Array[] {
  const bins = N_FFT / 2 + 1;
  const freqs = Array.from({ length: bins }, (_, i) => (i * RATE) / N_FFT);
  const lo = hz2mel(0);
  const hi = hz2mel(RATE / 2);
  const pts = Array.from({ length: MELS + 2 }, (_, i) => mel2hz(lo + ((hi - lo) * i) / (MELS + 1)));
  return Array.from({ length: MELS }, (_, m) => {
    const f = new Float32Array(bins);
    const [a, b, c] = [pts[m]!, pts[m + 1]!, pts[m + 2]!];
    const norm = 2 / (c - a);
    for (let i = 0; i < bins; i++) {
      const x = freqs[i]!;
      const up = (x - a) / (b - a);
      const down = (c - x) / (c - b);
      f[i] = Math.max(0, Math.min(up, down)) * norm;
    }
    return f;
  });
}

let tables: { filters: Float32Array[]; cos: Float32Array; sin: Float32Array; window: Float32Array } | null = null;
function prepared() {
  if (tables) return tables;
  const bins = N_FFT / 2 + 1;
  const cos = new Float32Array(bins * N_FFT);
  const sin = new Float32Array(bins * N_FFT);
  for (let k = 0; k < bins; k++)
    for (let n = 0; n < N_FFT; n++) {
      cos[k * N_FFT + n] = Math.cos((2 * Math.PI * k * n) / N_FFT);
      sin[k * N_FFT + n] = Math.sin((2 * Math.PI * k * n) / N_FFT);
    }
  const window = Float32Array.from({ length: N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT));
  tables = { filters: melFilters(), cos, sin, window };
  return tables;
}

/** The log-mel spectrogram of up to 30 s of sound, padded with silence, [80 × 3000]. */
export function logMel(audio: Float32Array): Float32Array {
  const { filters, cos, sin, window } = prepared();
  const bins = N_FFT / 2 + 1;
  const total = RATE * 30;
  const a = new Float32Array(total);
  a.set(audio.subarray(0, total));
  // Centered frames: the sound is mirrored at both ends.
  const pad = N_FFT / 2;
  const at = (i: number) => (i < 0 ? a[-i]! : i >= total ? a[2 * total - i - 2]! : a[i]!);
  const used = Math.min(FRAMES, Math.ceil(audio.length / HOP) + 2);
  const out = new Float32Array(MELS * FRAMES);
  const power = new Float32Array(bins);
  const frame = new Float32Array(N_FFT);
  const silent = new Float32Array(MELS).fill(-10);
  let max = -Infinity;
  for (let t = 0; t < FRAMES; t++) {
    if (t >= used) {
      for (let m = 0; m < MELS; m++) out[m * FRAMES + t] = silent[m]!;
      continue;
    }
    for (let n = 0; n < N_FFT; n++) frame[n] = at(t * HOP + n - pad) * window[n]!;
    for (let k = 0; k < bins; k++) {
      let re = 0;
      let im = 0;
      const o = k * N_FFT;
      for (let n = 0; n < N_FFT; n++) {
        re += frame[n]! * cos[o + n]!;
        im -= frame[n]! * sin[o + n]!;
      }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < MELS; m++) {
      const f = filters[m]!;
      let s = 0;
      for (let k = 0; k < bins; k++) s += f[k]! * power[k]!;
      const v = Math.log10(Math.max(s, 1e-10));
      out[m * FRAMES + t] = v;
      if (v > max) max = v;
    }
  }
  max = Math.max(max, -10);
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i]!, max - 8) + 4) / 4;
  return out;
}

// ---------------------------------------------------------------------------
// Word pieces back to text (byte-level, so every alphabet comes out right).

function byteDecoder(): Map<string, number> {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++)
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  return new Map(bs.map((b, i) => [String.fromCharCode(cs[i]!), b]));
}

export class ByteWords {
  private readonly pieces: string[] = [];
  private readonly bytes = byteDecoder();
  constructor(tokenizer: { model: { vocab: Record<string, number> }; added_tokens?: { id: number; content: string }[] }) {
    for (const [p, id] of Object.entries(tokenizer.model.vocab)) this.pieces[id] = p;
    for (const t of tokenizer.added_tokens ?? []) this.pieces[t.id] = t.content;
  }
  text(ids: number[]): string {
    const out: number[] = [];
    for (const id of ids) {
      if (id >= EOT) continue;
      for (const ch of this.pieces[id] ?? '') {
        const b = this.bytes.get(ch);
        if (b !== undefined) out.push(b);
      }
    }
    return new TextDecoder().decode(new Uint8Array(out)).trim();
  }
}

/** Whisper's language codes, in its order (token 50259 is English, then Chinese…). */
export const LANGUAGES =
  'en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su'.split(
    ' ',
  );

export interface WhisperFiles {
  encoder: Uint8Array;
  decoder: Uint8Array;
  tokenizer: ConstructorParameters<typeof ByteWords>[0];
  generation: { suppress_tokens?: number[]; begin_suppress_tokens?: number[] };
}

export class Whisper {
  private constructor(
    private readonly ort: typeof Ort,
    private readonly encoder: Ort.InferenceSession,
    private readonly decoder: Ort.InferenceSession,
    private readonly words: ByteWords,
    private readonly suppress: number[],
    private readonly beginSuppress: number[],
  ) {}

  static async load(ort: typeof Ort, f: WhisperFiles): Promise<Whisper> {
    const opts: Ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const [encoder, decoder] = await Promise.all([ort.InferenceSession.create(f.encoder, opts), ort.InferenceSession.create(f.decoder, opts)]);
    return new Whisper(ort, encoder, decoder, new ByteWords(f.tokenizer), f.generation.suppress_tokens ?? [], f.generation.begin_suppress_tokens ?? []);
  }

  /**
   * The words in `audio` (16 kHz) in `language` (a code like "he"; null: work it out).
   * With `task` "translate", what is said is written down in English, whatever language it is in.
   */
  async transcribe(audio: Float32Array, language: string | null, task: 'transcribe' | 'translate' = 'transcribe'): Promise<{ text: string; language: string }> {
    const TASK = task === 'translate' ? TRANSLATE : TRANSCRIBE;
    const { ort } = this;
    if (audio.length < 1600) return { text: '', language: language ?? '' };
    const features = new ort.Tensor('float32', logMel(audio), [1, MELS, FRAMES]);
    const hidden = (await this.encoder.run({ input_features: features })).last_hidden_state!;
    const empty = () => new ort.Tensor('float32', new Float32Array(0), [1, HEADS, 0, HEAD_DIM]);
    const past: Record<string, Ort.Tensor> = {};
    for (let i = 0; i < LAYERS; i++)
      for (const p of ['decoder', 'encoder']) for (const kv of ['key', 'value']) past[`past_key_values.${i}.${p}.${kv}`] = empty();
    let step = 0;
    const run = async (ids: number[]) => {
      const out = await this.decoder.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        encoder_hidden_states: hidden,
        use_cache_branch: new ort.Tensor('bool', [step > 0], [1]),
        ...past,
      });
      for (let i = 0; i < LAYERS; i++)
        for (const p of ['decoder', 'encoder'])
          for (const kv of ['key', 'value']) {
            const name = `${i}.${p}.${kv}`;
            if (p === 'decoder' || step === 0) past[`past_key_values.${name}`] = out[`present.${name}`]!;
          }
      step++;
      const logits = out.logits!.data as Float32Array;
      const vocab = out.logits!.dims[2]!;
      return logits.slice(logits.length - vocab);
    };
    // The language: as asked, or the one the model hears most likely.
    let langId: number;
    let first: Float32Array;
    if (language && LANGUAGES.includes(language)) {
      langId = FIRST_LANG + LANGUAGES.indexOf(language);
      first = await run([SOT, langId, TASK, NO_TIMESTAMPS]);
    } else {
      const l = await run([SOT]);
      langId = FIRST_LANG;
      for (let id = FIRST_LANG; id <= LAST_LANG; id++) if (l[id]! > l[langId]!) langId = id;
      first = await run([langId, TASK, NO_TIMESTAMPS]);
    }
    const ids: number[] = [];
    let logits = first;
    const most = Math.min(220, Math.ceil((audio.length / RATE) * 12) + 8);
    for (let n = 0; n < most; n++) {
      for (const s of this.suppress) logits[s] = -Infinity;
      if (n === 0) for (const s of this.beginSuppress) logits[s] = -Infinity;
      // No timestamps or other special tokens in the text.
      for (let s = EOT + 1; s < logits.length; s++) logits[s] = -Infinity;
      let best = 0;
      for (let i = 1; i < logits.length; i++) if (logits[i]! > logits[best]!) best = i;
      if (best === EOT) break;
      ids.push(best);
      // A loop of the same words (it can happen on noise): stop.
      if (ids.length > 12 && ids.slice(-6).join() === ids.slice(-12, -6).join()) break;
      logits = await run([best]);
    }
    return { text: this.words.text(ids), language: LANGUAGES[langId - FIRST_LANG] ?? '' };
  }
}
