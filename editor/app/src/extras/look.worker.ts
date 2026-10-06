// Looks at frames of a file for media search, away from the screens: faces
// (how many, how big), objects and people (MediaPipe's object detector) and
// what kind of scene it is (MediaPipe's image classifier, when it could be
// downloaded). Messages: load, then look at a file's times.
import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny';
import type { FaceDetector, ImageClassifier, ObjectDetector } from '@mediapipe/tasks-vision';
import type { Look } from './search';

type In =
  | { type: 'load'; wasm: string; face: string; objects: string; classifier: string | null }
  | { type: 'look'; id: number; url: string; times: number[]; width: number; still?: boolean };

let face: FaceDetector | null = null;
let objects: ObjectDetector | null = null;
let classifier: ImageClassifier | null = null;

async function load(m: Extract<In, { type: 'load' }>) {
  const mp = await import('@mediapipe/tasks-vision');
  const loaderUrl = `${m.wasm}vision_wasm_internal.js`;
  const text = await (await fetch(loaderUrl)).text();
  const blob = URL.createObjectURL(new Blob([text, '\nself.ModuleFactory = ModuleFactory;\n'], { type: 'text/javascript' }));
  const files = { wasmLoaderPath: blob, wasmBinaryPath: `${m.wasm}vision_wasm_internal.wasm` };
  const make = async <T>(f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch {
      return null;
    }
  };
  face = await make(() =>
    mp.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: m.face, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 }),
  );
  objects = await make(() =>
    mp.ObjectDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: m.objects, delegate: 'CPU' },
      runningMode: 'IMAGE',
      scoreThreshold: 0.4,
      maxResults: 12,
    }),
  );
  const cls = m.classifier;
  classifier = cls
    ? await make(() =>
        mp.ImageClassifier.createFromOptions(files, {
          baseOptions: { modelAssetPath: cls, delegate: 'CPU' },
          runningMode: 'IMAGE',
          maxResults: 4,
          scoreThreshold: 0.15,
        }),
      )
    : null;
  if (!face && !objects && !classifier) throw new Error('The picture models could not start on this computer.');
}

function look(canvas: OffscreenCanvas | HTMLCanvasElement, t: number): Look {
  const h = canvas.height;
  const faces = face?.detect(canvas).detections ?? [];
  const found = objects?.detect(canvas).detections ?? [];
  const labels = new Map<string, number>();
  let people = 0;
  for (const d of found) {
    const c = d.categories[0];
    if (!c?.categoryName) continue;
    if (c.categoryName === 'person') people++;
    labels.set(c.categoryName, Math.max(labels.get(c.categoryName) ?? 0, c.score));
  }
  for (const c of classifier?.classify(canvas).classifications[0]?.categories ?? [])
    if (c.categoryName) labels.set(c.categoryName, Math.max(labels.get(c.categoryName) ?? 0, c.score));
  const biggest = faces.reduce((m, d) => Math.max(m, (d.boundingBox?.height ?? 0) / h), 0);
  return {
    t,
    faces: faces.length,
    people: Math.max(people, faces.length),
    face: Math.round(biggest * 1000) / 1000,
    labels: [...labels.entries()].map(([k, v]) => [k, Math.round(v * 100) / 100] as [string, number]),
  };
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      await load(m);
      self.postMessage({ type: 'ready', classifier: !!classifier });
    } catch (err) {
      self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  const out: Look[] = [];
  try {
    if (m.still) {
      // A picture: looked at once.
      const bmp = await createImageBitmap(await (await fetch(m.url)).blob());
      const c = new OffscreenCanvas(m.width, Math.max(8, Math.round((bmp.height / Math.max(1, bmp.width)) * m.width)));
      (c.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(bmp, 0, 0, c.width, c.height);
      out.push(look(c, 0));
      self.postMessage({ type: 'found', id: m.id, looks: out });
      return;
    }
    const input = new Input({ source: new UrlSource(m.url), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (track && (await track.canDecode())) {
      const sink = new CanvasSink(track, { width: m.width, poolSize: 1 });
      let i = 0;
      for await (const frame of sink.canvasesAtTimestamps(m.times)) {
        if (frame) {
          try {
            out.push(look(frame.canvas, m.times[i] as number));
          } catch {
            // A frame that can't be looked at is skipped.
          }
        }
        i++;
        if (i % 10 === 0) self.postMessage({ type: 'progress', id: m.id, done: i / m.times.length });
      }
    }
  } catch {
    // A file that can't be read gives nothing.
  }
  self.postMessage({ type: 'found', id: m.id, looks: out });
};
