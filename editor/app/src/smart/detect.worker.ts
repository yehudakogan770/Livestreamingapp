// Finds faces (or, failing that, people) in frames of a video, away from the
// screens: frames are decoded small (mediabunny) and looked at by MediaPipe's
// face detector, offline. Messages: load, then look at a file's times.
import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny';
import type { FaceDetector, ObjectDetector } from '@mediapipe/tasks-vision';

type In = { type: 'load'; wasm: string; face: string; person: string } | { type: 'look'; id: number; url: string; times: number[]; width: number };

interface Found {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

let face: FaceDetector | null = null;
let person: ObjectDetector | null = null;

async function load(m: Extract<In, { type: 'load' }>) {
  const mp = await import('@mediapipe/tasks-vision');
  // MediaPipe's loader is a plain script; in a module worker it is run from a
  // blob that hands its factory to the worker (importScripts can't be used here).
  const loaderUrl = `${m.wasm}vision_wasm_internal.js`;
  const text = await (await fetch(loaderUrl)).text();
  const blob = URL.createObjectURL(new Blob([text, '\nself.ModuleFactory = ModuleFactory;\n'], { type: 'text/javascript' }));
  const files = { wasmLoaderPath: blob, wasmBinaryPath: `${m.wasm}vision_wasm_internal.wasm` };
  const make = async <T>(f: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T | null> => {
    try {
      return await f('CPU');
    } catch {
      return null;
    }
  };
  face = await make((delegate) =>
    mp.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: m.face, delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.45 }),
  );
  person = await make((delegate) =>
    mp.ObjectDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: m.person, delegate },
      runningMode: 'IMAGE',
      categoryAllowlist: ['person'],
      scoreThreshold: 0.35,
      maxResults: 6,
    }),
  );
  if (!face && !person) throw new Error('The face finder could not start on this computer.');
}

function look(canvas: OffscreenCanvas | HTMLCanvasElement): Found[] {
  const w = canvas.width;
  const h = canvas.height;
  const boxes = (list: { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { score: number }[] }[]) =>
    list
      .filter((d) => d.boundingBox)
      .map((d) => {
        const b = d.boundingBox as { originX: number; originY: number; width: number; height: number };
        return { x: b.originX / w, y: b.originY / h, w: b.width / w, h: b.height / h, score: d.categories[0]?.score ?? 0.5 };
      });
  const faces = face ? boxes(face.detect(canvas).detections) : [];
  if (faces.length || !person) return faces;
  // Nobody's face (turned away, too far): the top of each person instead.
  return boxes(person.detect(canvas).detections).map((b) => ({ ...b, h: Math.min(b.h, b.w * 0.9) }));
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      await load(m);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  const found: Found[][] = m.times.map(() => []);
  try {
    const input = new Input({ source: new UrlSource(m.url), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (track && (await track.canDecode())) {
      const sink = new CanvasSink(track, { width: m.width, poolSize: 1 });
      let i = 0;
      for await (const frame of sink.canvasesAtTimestamps(m.times)) {
        if (frame) {
          try {
            found[i] = look(frame.canvas);
          } catch {
            // A frame that can't be looked at is skipped.
          }
        }
        i++;
        if (i % 10 === 0) self.postMessage({ type: 'progress', id: m.id, done: i / m.times.length });
      }
    }
  } catch {
    // A file that can't be read gives nothing found (the picture stays centered).
  }
  self.postMessage({ type: 'found', id: m.id, found });
};
