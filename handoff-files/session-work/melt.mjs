import { logMel } from './mjs/whisper.js';
const a = new Float32Array(16000 * 8).map(() => Math.random() * 0.1);
let t = Date.now(); logMel(a); console.log('first', Date.now() - t); t = Date.now(); logMel(a); console.log('again', Date.now() - t);
