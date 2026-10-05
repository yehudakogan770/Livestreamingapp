// Copies the picture-smarts engine (MediaPipe, WebAssembly) next to the app,
// so background removal and auto-framing work offline. Runs before the UI
// starts or is built.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const from = 'node_modules/@mediapipe/tasks-vision/wasm';
const to = 'app/public/mediapipe';
mkdirSync(to, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  if (!existsSync(`${from}/${f}`)) throw new Error(`Missing ${from}/${f}: run npm install`);
  copyFileSync(`${from}/${f}`, `${to}/${f}`);
}
