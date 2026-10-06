// Runs Lumora's Whisper speech model away from the screens, so transcribing
// never slows editing. Messages: load the model, then transcribe stretches.
import * as ort from 'onnxruntime-web/wasm';
import { Whisper } from '../../../../app/src/captions/whisper';

let model: Whisper | null = null;

type In =
  | { type: 'load'; ortBase: string; files: Record<string, string> }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string | null; task?: 'transcribe' | 'translate' };

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      ort.env.wasm.wasmPaths = m.ortBase;
      // One thread: the window isn't set up for shared memory.
      ort.env.wasm.numThreads = 1;
      const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
      const json = async (url: string) => (await fetch(url)).json();
      const f = m.files;
      model = await Whisper.load(ort, {
        encoder: await bytes(f.encoder as string),
        decoder: await bytes(f.decoder as string),
        tokenizer: await json(f.tokenizer as string),
        generation: await json(f.generation as string),
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (m.type === 'transcribe') {
    let text = '';
    let language = m.language ?? '';
    try {
      if (model) ({ text, language } = await model.transcribe(m.audio, m.language, m.task));
    } catch {
      // A stretch that fails is skipped; the next one carries on.
    }
    self.postMessage({ type: 'text', id: m.id, text, language });
  }
};
