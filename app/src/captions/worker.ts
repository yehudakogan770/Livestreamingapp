// Runs the speech model away from the screens, so recognizing words never
// slows the picture. Messages: load a model, then transcribe phrases.

import * as ort from 'onnxruntime-web/wasm';
import { Moonshine } from './moonshine';
import { Whisper } from './whisper';

let model: { transcribe(audio: Float32Array): Promise<string> } | null = null;

type In =
  | { type: 'load'; ortBase: string; kind: 'moonshine' | 'whisper'; language: string | null; files: Record<string, string> }
  | { type: 'transcribe'; id: number; audio: Float32Array };

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      ort.env.wasm.wasmPaths = m.ortBase;
      // One thread: Lumora's window isn't set up for shared memory.
      ort.env.wasm.numThreads = 1;
      const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
      const json = async (url: string) => (await fetch(url)).json();
      const f = m.files;
      if (m.kind === 'moonshine') {
        model = await Moonshine.load(ort, { encoder: await bytes(f.encoder!), decoder: await bytes(f.decoder!), tokenizer: await json(f.tokenizer!) });
      } else {
        const w = await Whisper.load(ort, {
          encoder: await bytes(f.encoder!),
          decoder: await bytes(f.decoder!),
          tokenizer: await json(f.tokenizer!),
          generation: await json(f.generation!),
        });
        const language = m.language;
        model = { transcribe: async (audio) => (await w.transcribe(audio, language)).text };
      }
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (m.type === 'transcribe') {
    let text = '';
    try {
      text = model ? await model.transcribe(m.audio) : '';
    } catch {
      // A phrase that fails is skipped; the next one carries on.
    }
    self.postMessage({ type: 'text', id: m.id, text });
  }
};
