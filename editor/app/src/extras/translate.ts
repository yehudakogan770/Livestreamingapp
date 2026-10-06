// Translating captions, offline. To English: Whisper listens to the speech
// again and writes it down in English (whatever language is spoken). To other
// languages: an English captions track is translated line by line by a small
// on-device model (Opus-MT), downloaded the first time it is used. Either way
// the result is a new captions track, so the original stays, and every line
// can be edited.
import { addCaptionTrack, captionBlocks, captionTracks, rulesFor, sequenceWords, type Block } from '../model/captions';
import { current, editSeq, rate } from '../model/seq';
import { DEFAULT_CAPTION_STYLE, newClip, type Project, type Sequence } from '../model/types';
import { mediaUrl, native, onSpeechProgress } from '../native';
import { spansToTranscribe, Transcriber, withTranscripts, type SpeechModel, type SpeechProgress } from '../speech/transcribe';
import { MT_LANGUAGES } from './marian';

/** The caption blocks on a captions track, in order. */
export function trackBlocks(s: Sequence, track: string): Block[] {
  return s.clips
    .filter((c) => c.track === track && c.source.kind === 'caption')
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ from: c.start, to: c.start + c.length, text: c.source.kind === 'caption' ? c.source.text : '' }));
}

/** A new captions track named for its language (looking like `like`, or the default), holding these blocks. */
export function addTranslatedTrack(p: Project, blocks: Block[], language: string, like?: string): { project: Project; track: string } {
  const s = current(p);
  const style = (like ? s.tracks.find((t) => t.id === like)?.captions : undefined) ?? captionTracks(s)[0]?.captions ?? DEFAULT_CAPTION_STYLE;
  const made = addCaptionTrack(p, style);
  const project = editSeq(made.project, (seq) => ({
    ...seq,
    tracks: seq.tracks.map((t) => (t.id === made.id ? { ...t, name: `Captions (${language})` } : t)),
    clips: [
      ...seq.clips,
      ...blocks.filter((b) => b.text.trim()).map((b) => newClip(made.id, b.from, Math.max(1, b.to - b.from), { kind: 'caption', text: b.text }, b.text)),
    ],
  }));
  return { project, track: made.id };
}

/** Whisper's English, as caption blocks for the sequence (from the chosen clips' sound, or all of it). */
export async function englishFromSpeech(
  p: Project,
  ids: string[] | null,
  model: SpeechModel,
  language: string | null,
  report: (x: SpeechProgress) => void,
  stopRef: { stop?: () => void },
): Promise<Block[]> {
  const s = current(p);
  const spans = spansToTranscribe(p, s, ids);
  if (spans.size === 0) throw new Error('There is no speech to translate: put sound clips on the timeline (or choose some).');
  const t = new Transcriber(model, language, report, 'translate');
  stopRef.stop = () => t.stop();
  // The files' own transcripts are left out: only the English is wanted here.
  const media = p.media.filter((m) => spans.has(m.id)).map((m) => ({ ...m, transcript: undefined }));
  const found = await t.run(media, spans);
  const english = withTranscripts(p, found);
  const words = sequenceWords(english, current(english));
  const style = captionTracks(s)[0]?.captions ?? DEFAULT_CAPTION_STYLE;
  return captionBlocks(words, rate(s), rulesFor(style));
}

const MT_FILES = {
  encoder: 'encoder_model_quantized.onnx',
  decoder: 'decoder_model_merged_quantized.onnx',
  tokenizer: 'tokenizer.json',
  config: 'config.json',
};

/** One translation model, running in a worker. */
export class Translator {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, (text: string) => void>();
  private stopped = false;

  constructor(
    private language: string,
    private report: (p: SpeechProgress) => void,
  ) {}

  async start(): Promise<void> {
    const lang = MT_LANGUAGES.find((l) => l.code === this.language);
    if (!lang) throw new Error('Lumora Studio can’t translate into that language on this computer.');
    this.report({ stage: 'download', done: 0, message: `Getting the ${lang.name} translation model ready…` });
    const off = onSpeechProgress(([name, done]) => {
      if (name === lang.model)
        this.report({
          stage: 'download',
          done,
          message: `Downloading the ${lang.name} translation model (one time only, about 110 MB): ${Math.round(done * 100)}%`,
        });
    });
    let folder: string;
    try {
      folder = await native.speechModel(lang.model);
    } finally {
      off();
    }
    if (this.stopped) throw new Error('Stopped.');
    this.report({ stage: 'starting', done: 0, message: 'Starting the translation model…' });
    const sep = folder.includes('\\') ? '\\' : '/';
    const worker = new Worker(new URL('./translate.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ type: string; message?: string }>) =>
        e.data.type === 'ready' ? resolve() : reject(new Error(e.data.message ?? 'The translation model could not start.'));
      worker.onerror = (e) => reject(new Error(e.message || 'The translation model could not start.'));
      worker.postMessage({
        type: 'load',
        ortBase: new URL('ort/', document.baseURI).href,
        files: Object.fromEntries(Object.entries(MT_FILES).map(([k, f]) => [k, mediaUrl(`${folder}${sep}${f}`)])),
      });
    });
    worker.onmessage = (e: MessageEvent<{ id: number; text: string }>) => {
      const f = this.waiting.get(e.data.id);
      this.waiting.delete(e.data.id);
      f?.(e.data.text);
    };
  }

  translate(text: string): Promise<string> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker?.postMessage({ type: 'translate', id, text });
    });
  }

  /** Each block's words translated (a line that can't be is kept as it was). */
  async blocks(list: Block[]): Promise<Block[]> {
    await this.start();
    const out: Block[] = [];
    for (const [i, b] of list.entries()) {
      if (this.stopped) throw new Error('Stopped.');
      const text = b.text.trim() ? await this.translate(b.text) : '';
      out.push({ ...b, text: text || b.text });
      this.report({ stage: 'listening', done: (i + 1) / list.length, message: `Translating line ${i + 1} of ${list.length}…` });
    }
    this.stop();
    return out;
  }

  stop() {
    this.stopped = true;
    this.worker?.terminate();
    this.worker = null;
    for (const f of this.waiting.values()) f('');
    this.waiting.clear();
  }
}
