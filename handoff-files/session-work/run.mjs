globalThis.DEBUG = true;
import * as ort from '/home/user/Livestreamingapp/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import fs from 'node:fs';
import { Moonshine, to16k } from './mjs/moonshine.js';
ort.env.wasm.numThreads = 1;
const d = process.argv[2];
const m = await Moonshine.load(ort, { encoder: fs.readFileSync(d + '/onnx/encoder_model_quantized.onnx'), decoder: fs.readFileSync(d + '/onnx/decoder_model_merged_quantized.onnx'), tokenizer: JSON.parse(fs.readFileSync(d + '/tokenizer.json')) });
// test.wav: 16-bit PCM
const wav = fs.readFileSync(process.argv[3]);
const rate = wav.readUInt32LE(24), ch = wav.readUInt16LE(22);
let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
const n = wav.readUInt32LE(off + 4) / 2 / ch; const f = new Float32Array(n);
for (let i = 0; i < n; i++) f[i] = wav.readInt16LE(off + 8 + i * 2 * ch) / 32768;
console.log('rate', rate, 'seconds', (n / rate).toFixed(1));
const a = to16k(f, rate);
for (const [s, e] of [[0, 8.3], [0, 3.2], [3.2, 8.3]]) { const t0 = Date.now(); const txt = await m.transcribe(a.slice(s * 16000, e * 16000)); console.log(`${s}-${e}s (${Date.now() - t0} ms):`, txt); }
