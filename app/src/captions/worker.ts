// Runs the speech model away from the screens, so recognizing words never
// slows the picture. Messages: load the model, then transcribe phrases.

import * as ort from 'onnxruntime-web/wasm';
import { Moonshine } from './moonshine';

let model: Moonshine | null = null;

type In = { type: 'load'; ortBase: string; encoder: string; decoder: string; tokenizer: string } | { type: 'transcribe'; id: number; audio: Float32Array };

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      ort.env.wasm.wasmPaths = m.ortBase;
      // One thread: Lumora's window isn't set up for shared memory, and it's fast enough.
      ort.env.wasm.numThreads = 1;
      const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
      const [encoder, decoder, tokenizer] = await Promise.all([bytes(m.encoder), bytes(m.decoder), fetch(m.tokenizer).then((r) => r.json())]);
      model = await Moonshine.load(ort, { encoder, decoder, tokenizer });
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
