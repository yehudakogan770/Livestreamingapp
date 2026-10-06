// Runs a translation model away from the screens. Messages: load the model,
// then translate lines of text.
import * as ort from 'onnxruntime-web/wasm';
import { Marian } from './marian';

let model: Marian | null = null;

type In = { type: 'load'; ortBase: string; files: Record<string, string> } | { type: 'translate'; id: number; text: string };

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      ort.env.wasm.wasmPaths = m.ortBase;
      ort.env.wasm.numThreads = 1;
      const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
      const json = async (url: string) => (await fetch(url)).json();
      const f = m.files;
      model = await Marian.load(ort, {
        encoder: await bytes(f.encoder as string),
        decoder: await bytes(f.decoder as string),
        tokenizer: await json(f.tokenizer as string),
        config: await json(f.config as string),
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  let text = '';
  try {
    if (model) text = await model.translate(m.text);
  } catch {
    // A line that fails stays as it was (the caller keeps the original).
  }
  self.postMessage({ type: 'text', id: m.id, text });
};
