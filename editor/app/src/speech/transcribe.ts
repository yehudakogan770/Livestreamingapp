// Transcribe: write down what is said in the sequence's sound, offline. The
// speech model (Whisper, base or small) is downloaded the first time; each
// file's sound is read a couple of minutes at a time, cut where people
// pause, and each stretch written down by the model in a worker.
import { evenLevel } from '../../../../app/src/captions/moonshine';
import { withLinked } from '../model/edit';
import { end, rate } from '../model/seq';
import type { MediaItem, Project, Sequence, Transcript, Word } from '../model/types';
import { mediaUrl, native, onSpeechProgress } from '../native';
import { findPhrases, levels, mergeWords, RATE, spreadWords, unite } from './phrases';

export type SpeechModel = 'whisper-base' | 'whisper-small';

/** The parts of each file to listen to (seconds), for some clips or the whole sequence. */
export function spansToTranscribe(p: Project, s: Sequence, ids: string[] | null): Map<string, [number, number][]> {
  const fps = rate(s);
  const chosen = ids ? new Set(withLinked(s, ids)) : null;
  const out = new Map<string, [number, number][]>();
  for (const c of s.clips) {
    if (chosen && !chosen.has(c.id)) continue;
    const t = s.tracks.find((x) => x.id === c.track);
    if (t?.kind !== 'audio' || !c.enabled || c.source.kind !== 'media') continue;
    const src = c.source;
    const m = p.media.find((x) => x.id === src.media);
    if (!m?.hasAudio) continue;
    // A second either side, so words at the cut are heard whole.
    const from = Math.max(0, src.in - 1);
    const to = Math.min(m.duration || Infinity, src.in + (c.length * c.speed) / fps + 1);
    out.set(m.id, [...(out.get(m.id) ?? []), [from, to]]);
  }
  for (const [k, v] of out) out.set(k, unite(v));
  return out;
}

/** The sequence frames that captions are made for: the chosen clips' span, or everything. */
export function captionRange(s: Sequence, ids: string[] | null): { from: number; to: number } {
  const clips = ids ? s.clips.filter((c) => withLinked(s, ids).includes(c.id)) : s.clips;
  if (!clips.length) return { from: 0, to: 0 };
  return { from: Math.min(...clips.map((c) => c.start)), to: Math.max(...clips.map(end)) };
}

export interface SpeechProgress {
  stage: 'download' | 'starting' | 'listening' | 'done';
  /** 0–1. */
  done: number;
  message: string;
}

const FILES = {
  encoder: 'encoder_model_quantized.onnx',
  decoder: 'decoder_model_merged_quantized.onnx',
  tokenizer: 'tokenizer.json',
  generation: 'generation_config.json',
};

/** Sound read at a time (seconds). */
const WINDOW = 120;

export class Transcriber {
  private worker: Worker | null = null;
  private stopped = false;
  private next = 1;
  private waiting = new Map<number, (r: { text: string; language: string }) => void>();

  constructor(
    private model: SpeechModel,
    /** A language code, or null: worked out from what is heard first. */
    private language: string | null,
    private report: (p: SpeechProgress) => void,
    /** "translate": what is said is written down in English (Whisper's own translation). */
    private task: 'transcribe' | 'translate' = 'transcribe',
  ) {}

  stop() {
    this.stopped = true;
    this.worker?.terminate();
    this.worker = null;
    for (const f of this.waiting.values()) f({ text: '', language: '' });
    this.waiting.clear();
  }

  private async start() {
    this.report({ stage: 'download', done: 0, message: 'Getting the speech model ready…' });
    const stop = onSpeechProgress(([name, done]) => {
      if (name === this.model) this.report({ stage: 'download', done, message: `Downloading the speech model (one time only): ${Math.round(done * 100)}%` });
    });
    let folder: string;
    try {
      folder = await native.speechModel(this.model);
    } finally {
      stop();
    }
    if (this.stopped) throw new Error('Stopped.');
    this.report({ stage: 'starting', done: 0, message: 'Starting the speech model…' });
    const sep = folder.includes('\\') ? '\\' : '/';
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ type: string; message?: string }>) =>
        e.data.type === 'ready' ? resolve() : reject(new Error(e.data.message ?? 'The speech model could not start.'));
      worker.onerror = (e) => reject(new Error(e.message || 'The speech model could not start.'));
      worker.postMessage({
        type: 'load',
        ortBase: new URL('ort/', document.baseURI).href,
        files: Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, mediaUrl(`${folder}${sep}${f}`)])),
      });
    });
    worker.onmessage = (e: MessageEvent<{ type: string; id: number; text: string; language: string }>) => {
      const f = this.waiting.get(e.data.id);
      this.waiting.delete(e.data.id);
      f?.({ text: e.data.text, language: e.data.language });
    };
  }

  private ask(audio: Float32Array): Promise<{ text: string; language: string }> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker?.postMessage({ type: 'transcribe', id, audio, language: this.language, task: this.task }, [audio.buffer]);
    });
  }

  /** Write down what is said in each file's spans. Gives each file's transcript (old words outside the spans are kept). */
  async run(media: MediaItem[], spans: Map<string, [number, number][]>): Promise<Map<string, Transcript>> {
    await this.start();
    const total = [...spans.values()].flat().reduce((a, [x, y]) => a + (y - x), 0) || 1;
    let heard = 0;
    const out = new Map<string, Transcript>();
    for (const m of media) {
      const list = spans.get(m.id);
      if (!list?.length) continue;
      const words: Word[] = [];
      for (const [from, to] of list) {
        let t = from;
        while (t < to - 0.05) {
          if (this.stopped) throw new Error('Stopped.');
          const len = Math.min(WINDOW, to - t);
          const last = t + len >= to - 0.05;
          const audio = await native.speechAudio(m.missing && m.proxy ? m.proxy : m.path, t, len);
          const got = audio.length / RATE;
          const phrases = findPhrases(audio);
          // A stretch still going at the end of what was read is read again with what follows.
          const open = !last && got >= len - 0.05 ? phrases.find(([, b]) => b >= got - 1) : undefined;
          for (const [a, b] of phrases) {
            if (open && a >= open[0]) break;
            const piece = audio.slice(Math.floor(a * RATE), Math.ceil(b * RATE));
            const db = levels(piece);
            const r = await this.ask(evenLevel(piece));
            if (this.stopped) throw new Error('Stopped.');
            // Worked out once, then kept (short stretches can sound like another language).
            if (!this.language && r.text.replace(/\s/g, '').length >= 12 && r.language) this.language = r.language;
            words.push(...spreadWords(r.text, t + a, t + b, db));
            this.report({
              stage: 'listening',
              done: Math.min(1, (heard + (t - from) + b) / total),
              message: `Listening to ${m.name}… ${words.length} words so far`,
            });
          }
          const step = open && open[0] > 1 ? open[0] : got > 0.5 ? got : len;
          t += step;
        }
        heard += to - from;
      }
      const before = m.transcript;
      out.set(m.id, {
        language: this.language ?? before?.language ?? '',
        model: this.model,
        words: mergeWords(before?.words ?? [], words, list),
        done: unite([...(before?.done ?? []), ...list]),
      });
    }
    this.report({ stage: 'done', done: 1, message: 'Done.' });
    this.worker?.terminate();
    this.worker = null;
    return out;
  }
}

/** The project with new transcripts on its files. */
export function withTranscripts(p: Project, found: Map<string, Transcript>): Project {
  return { ...p, media: p.media.map((m) => (found.has(m.id) ? { ...m, transcript: found.get(m.id) } : m)) };
}
