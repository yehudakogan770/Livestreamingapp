import * as ort from '/home/user/Livestreamingapp/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import fs from 'node:fs';
import { Whisper } from './mjs/whisper.js';
import { to16k, evenLevel } from './mjs/moonshine.js';
ort.env.wasm.numThreads = 1;
const d = process.argv[2];
const w = await Whisper.load(ort, { encoder: fs.readFileSync(d + '/onnx/encoder_model_quantized.onnx'), decoder: fs.readFileSync(d + '/onnx/decoder_model_merged_quantized.onnx'), tokenizer: JSON.parse(fs.readFileSync(d + '/tokenizer.json')), generation: JSON.parse(fs.readFileSync(d + '/generation_config.json')) });
const wav = fs.readFileSync(process.argv[3]); let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
const n = wav.readUInt32LE(off + 4) / 2; const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = wav.readInt16LE(off + 8 + i * 2) / 32768;
const a = evenLevel(f);
for (const lang of [null, 'en']) { const t0 = Date.now(); const r = await w.transcribe(a, lang); console.log(lang ?? 'detect', `(${Date.now() - t0} ms):`, JSON.stringify(r)); }
