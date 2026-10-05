// Copies the engines that run on the computer, offline, next to the app:
// picture smarts (MediaPipe: background removal, auto-framing, and Lumora
// Studio's Auto reframe) and the speech engine for live captions (ONNX Runtime,
// which Lumora Studio uses to transcribe too). Runs before either UI starts or is built.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const from = 'node_modules/@mediapipe/tasks-vision/wasm';
// Lumora Studio uses them too: finding faces for Auto reframe.
for (const to of ['app/public/mediapipe', 'editor/app/public/mediapipe']) {
  mkdirSync(to, { recursive: true });
  for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
    if (!existsSync(`${from}/${f}`)) throw new Error(`Missing ${from}/${f}: run npm install`);
    copyFileSync(`${from}/${f}`, `${to}/${f}`);
  }
}
// The people finder Lumora ships, for when no face can be seen.
mkdirSync('editor/app/public/models', { recursive: true });
copyFileSync('app/public/models/efficientdet_lite0.tflite', 'editor/app/public/models/efficientdet_lite0.tflite');

const ortFrom = 'node_modules/onnxruntime-web/dist';
for (const ortTo of ['app/public/ort', 'editor/app/public/ort']) {
  mkdirSync(ortTo, { recursive: true });
  for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    if (!existsSync(`${ortFrom}/${f}`)) throw new Error(`Missing ${ortFrom}/${f}: run npm install`);
    copyFileSync(`${ortFrom}/${f}`, `${ortTo}/${f}`);
  }
}
