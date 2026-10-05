// Copies the engines that run on the computer, offline, next to the app:
// picture smarts (MediaPipe: background removal, auto-framing) and the
// speech engine for live captions (ONNX Runtime, which Lumora Studio uses to
// transcribe too). Runs before either UI starts or is built.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const from = 'node_modules/@mediapipe/tasks-vision/wasm';
const to = 'app/public/mediapipe';
mkdirSync(to, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  if (!existsSync(`${from}/${f}`)) throw new Error(`Missing ${from}/${f}: run npm install`);
  copyFileSync(`${from}/${f}`, `${to}/${f}`);
}

const ortFrom = 'node_modules/onnxruntime-web/dist';
for (const ortTo of ['app/public/ort', 'editor/app/public/ort']) {
  mkdirSync(ortTo, { recursive: true });
  for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    if (!existsSync(`${ortFrom}/${f}`)) throw new Error(`Missing ${ortFrom}/${f}: run npm install`);
    copyFileSync(`${ortFrom}/${f}`, `${ortTo}/${f}`);
  }
}
