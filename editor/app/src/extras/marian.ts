// On-device translation from English: Helsinki-NLP's Opus-MT (Marian) models,
// quantized ONNX, run by ONNX Runtime. Each language pair is one small model
// (about 110 MB), downloaded the first time it is used. The tokenizer is a
// SentencePiece unigram model, read from the model's tokenizer.json.

import type * as Ort from 'onnxruntime-web';

const LAYERS = 6;
const HEADS = 8;
const HEAD_DIM = 64;
const SPACE = '▁';

interface TokenizerJson {
  model: { type: string; vocab: [string, number][]; unk_id?: number };
  added_tokens?: { id: number; content: string }[];
}

/** SentencePiece unigram tokenizing (Viterbi: the most likely split of each word into pieces). */
export class Unigram {
  private ids = new Map<string, number>();
  private scores: number[];
  private pieces: string[];
  private longest = 1;
  readonly unk: number;
  private special = new Set<number>();

  constructor(json: TokenizerJson) {
    const vocab = json.model.vocab;
    this.pieces = vocab.map((v) => v[0]);
    this.scores = vocab.map((v) => v[1]);
    vocab.forEach(([piece], i) => {
      if (!this.ids.has(piece)) this.ids.set(piece, i);
      this.longest = Math.max(this.longest, piece.length);
    });
    this.unk = this.ids.get('<unk>') ?? json.model.unk_id ?? 1;
    for (const t of json.added_tokens ?? []) this.special.add(t.id);
    const min = this.scores.reduce((a, b) => Math.min(a, b), 0);
    this.unkScore = min - 10;
  }
  private unkScore: number;

  /** One word (already with its leading ▁) as piece ids. */
  private word(w: string): number[] {
    const n = w.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1).fill(-1);
    const piece = new Int32Array(n + 1).fill(-1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      let any = false;
      for (let len = 1; len <= Math.min(this.longest, n - i); len++) {
        const id = this.ids.get(w.slice(i, i + len));
        if (id === undefined || this.special.has(id)) continue;
        any = any || len === 1;
        const s = (best[i] as number) + (this.scores[id] as number);
        if (s > (best[i + len] as number)) {
          best[i + len] = s;
          from[i + len] = i;
          piece[i + len] = id;
        }
      }
      // A letter the model doesn't know: one unknown piece.
      if (!any) {
        const s = (best[i] as number) + this.unkScore;
        if (s > (best[i + 1] as number)) {
          best[i + 1] = s;
          from[i + 1] = i;
          piece[i + 1] = this.unk;
        }
      }
    }
    const out: number[] = [];
    for (let i = n; i > 0; i = from[i] as number) {
      if ((from[i] as number) < 0) return [this.unk];
      out.push(piece[i] as number);
    }
    out.reverse();
    // Unknown letters next to each other become one unknown piece.
    return out.filter((id, k) => !(id === this.unk && out[k - 1] === this.unk));
  }

  encode(text: string): number[] {
    const words = text.normalize('NFKC').trim().split(/\s+/).filter(Boolean);
    return words.flatMap((w) => this.word(SPACE + w));
  }

  decode(ids: number[]): string {
    return ids
      .filter((id) => !this.special.has(id) && id !== this.unk)
      .map((id) => this.pieces[id] ?? '')
      .join('')
      .replaceAll(SPACE, ' ')
      .trim();
  }
}

export interface MarianFiles {
  encoder: Uint8Array;
  decoder: Uint8Array;
  tokenizer: TokenizerJson;
  config: { eos_token_id?: number; pad_token_id?: number; decoder_start_token_id?: number; bad_words_ids?: number[][] };
}

export class Marian {
  private constructor(
    private readonly ort: typeof Ort,
    private readonly encoder: Ort.InferenceSession,
    private readonly decoder: Ort.InferenceSession,
    readonly tokens: Unigram,
    private readonly eos: number,
    private readonly start: number,
    private readonly banned: number[],
  ) {}

  static async load(ort: typeof Ort, f: MarianFiles): Promise<Marian> {
    const opts: Ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const [encoder, decoder] = await Promise.all([ort.InferenceSession.create(f.encoder, opts), ort.InferenceSession.create(f.decoder, opts)]);
    const eos = f.config.eos_token_id ?? 0;
    const pad = f.config.pad_token_id ?? f.config.decoder_start_token_id ?? 0;
    const start = f.config.decoder_start_token_id ?? pad;
    const banned = [...new Set([pad, ...(f.config.bad_words_ids ?? []).flat()])].filter((x) => x !== eos);
    return new Marian(ort, encoder, decoder, new Unigram(f.tokenizer), eos, start, banned);
  }

  /** One sentence or caption, translated (greedy decoding). */
  async translate(text: string): Promise<string> {
    const { ort } = this;
    const src = [...this.tokens.encode(text).slice(0, 400), this.eos];
    if (src.length <= 1) return '';
    const ids = new ort.Tensor('int64', BigInt64Array.from(src.map(BigInt)), [1, src.length]);
    const mask = new ort.Tensor('int64', new BigInt64Array(src.length).fill(1n), [1, src.length]);
    const hidden = (await this.encoder.run({ input_ids: ids, attention_mask: mask })).last_hidden_state!;
    const empty = () => new ort.Tensor('float32', new Float32Array(0), [1, HEADS, 0, HEAD_DIM]);
    const past: Record<string, Ort.Tensor> = {};
    for (let i = 0; i < LAYERS; i++)
      for (const p of ['decoder', 'encoder']) for (const kv of ['key', 'value']) past[`past_key_values.${i}.${p}.${kv}`] = empty();
    const wants = new Set(this.decoder.inputNames);
    let step = 0;
    const run = async (id: number): Promise<Float32Array> => {
      const feeds: Record<string, Ort.Tensor> = {
        input_ids: new ort.Tensor('int64', BigInt64Array.from([BigInt(id)]), [1, 1]),
        encoder_hidden_states: hidden,
        encoder_attention_mask: mask,
        ...past,
      };
      if (wants.has('use_cache_branch')) feeds.use_cache_branch = new ort.Tensor('bool', [step > 0], [1]);
      const out = await this.decoder.run(Object.fromEntries(Object.entries(feeds).filter(([k]) => wants.has(k))));
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
    const outIds: number[] = [];
    let logits = await run(this.start);
    const most = Math.min(256, src.length * 3 + 10);
    for (let n = 0; n < most; n++) {
      for (const b of this.banned) logits[b] = -Infinity;
      let best = 0;
      for (let i = 1; i < logits.length; i++) if (logits[i]! > logits[best]!) best = i;
      if (best === this.eos) break;
      outIds.push(best);
      if (outIds.length > 12 && outIds.slice(-6).join() === outIds.slice(-12, -6).join()) break;
      logits = await run(best);
    }
    return this.tokens.decode(outIds);
  }
}

/** The languages Lumora Studio can translate English captions into on this computer (one Opus-MT model each). */
export const MT_LANGUAGES: { code: string; name: string; model: string }[] = [
  { code: 'de', name: 'German', model: 'mt-en-de' },
  { code: 'fr', name: 'French', model: 'mt-en-fr' },
  { code: 'es', name: 'Spanish', model: 'mt-en-es' },
  { code: 'it', name: 'Italian', model: 'mt-en-it' },
  { code: 'nl', name: 'Dutch', model: 'mt-en-nl' },
  { code: 'ru', name: 'Russian', model: 'mt-en-ru' },
  { code: 'uk', name: 'Ukrainian', model: 'mt-en-uk' },
  { code: 'sv', name: 'Swedish', model: 'mt-en-sv' },
  { code: 'fi', name: 'Finnish', model: 'mt-en-fi' },
  { code: 'cs', name: 'Czech', model: 'mt-en-cs' },
  { code: 'ro', name: 'Romanian', model: 'mt-en-ro' },
  { code: 'vi', name: 'Vietnamese', model: 'mt-en-vi' },
  { code: 'id', name: 'Indonesian', model: 'mt-en-id' },
  { code: 'hi', name: 'Hindi', model: 'mt-en-hi' },
  { code: 'ja', name: 'Japanese', model: 'mt-en-jap' },
];
