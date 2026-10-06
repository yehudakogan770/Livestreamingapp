// The AI models that find people and objects in a picture (MediaPipe, offline,
// on this computer; the same engine Lumora uses to take the background away
// on air). They load the first time they're needed. If they can't run here,
// "Select person" can't work and "Select object" picks by color instead.
import type { ImageSegmenter, InteractiveSegmenterLegacy, MPMask } from '@mediapipe/tasks-vision';
import { floodSelect, type Matte } from './matte';

interface Models {
  person: ImageSegmenter | null;
  touch: InteractiveSegmenterLegacy | null;
}

let loading: Promise<Models> | null = null;
let ready: Models | null = null;

const url = (path: string) => new URL(path, document.baseURI).href;

async function load(): Promise<Models> {
  const mp = await import('@mediapipe/tasks-vision');
  const files = await mp.FilesetResolver.forVisionTasks(url('mediapipe'));
  // The graphics card when it can, the processor when it can't.
  const make = async <T>(f: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T | null> => {
    try {
      return await f('GPU');
    } catch {
      try {
        return await f('CPU');
      } catch (e) {
        console.warn('Lumora Studio: an AI model could not start', e);
        return null;
      }
    }
  };
  const person = await make((delegate) =>
    mp.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: url('models/selfie_segmenter.tflite'), delegate },
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    }),
  );
  const touch = await make((delegate) =>
    mp.InteractiveSegmenterLegacy.createFromOptions(files, {
      baseOptions: { modelAssetPath: url('models/magic_touch.tflite'), delegate },
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    }),
  );
  return { person, touch };
}

/** The models (loaded the first time). */
export function models(): Promise<Models> {
  if (!loading) {
    loading = load().catch((e: unknown) => {
      console.warn('Lumora Studio: the AI models could not load', e);
      return { person: null, touch: null };
    });
    void loading.then((m) => (ready = m));
  }
  return loading;
}

/** What is known about the models so far (for the screens): null while loading. */
export const modelsNow = (): Models | null => ready;

/** A confidence mask as a matte (0–255). */
function toMatte(mask: MPMask): Matte {
  const f = mask.getAsFloat32Array();
  const data = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) data[i] = Math.max(0, Math.min(255, Math.round((f[i] as number) * 255)));
  return { w: mask.width, h: mask.height, data };
}

/** The picture to look at: a canvas the size asked, drawn from any picture. */
export function canvasOf(src: CanvasImageSource | ImageData, w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(drawable(src), 0, 0, w, h);
  return c;
}

/** Raw pixels (a frame FFmpeg read from the original) can't be drawn scaled: they go on a canvas of their own first. */
function drawable(src: CanvasImageSource | ImageData): CanvasImageSource {
  if (typeof ImageData === 'undefined' || !(src instanceof ImageData)) return src as CanvasImageSource;
  const c = new OffscreenCanvas(src.width, src.height);
  (c.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(src, 0, 0);
  return c;
}

/** The people in a picture (null when the model can't run here). */
export async function segmentPerson(pic: OffscreenCanvas): Promise<Matte | null> {
  const m = await models();
  if (!m.person) return null;
  const r = m.person.segment(pic);
  try {
    const masks = r.confidenceMasks;
    // One mask (how sure it is a person), or background then person.
    const mask = masks?.[masks.length - 1];
    return mask ? toMatte(mask) : null;
  } finally {
    r.close();
  }
}

/** How "Select object" found the object. */
export type ObjectMethod = 'ai' | 'color';

/** The object at a spot (u, v: 0–1) of a picture: the AI model's pick, or the region of that color without it. */
export async function segmentObject(pic: OffscreenCanvas, u: number, v: number, tolerance: number): Promise<{ matte: Matte; how: ObjectMethod }> {
  const m = await models();
  const x = Math.max(0, Math.min(1, u));
  const y = Math.max(0, Math.min(1, v));
  if (m.touch) {
    const r = m.touch.segment(pic, { keypoint: { x, y } });
    try {
      const masks = r.confidenceMasks;
      const mask = masks?.[masks.length - 1];
      if (mask) {
        let matte = toMatte(mask);
        // Some models say how sure it is that a spot is NOT the object: the clicked spot tells which.
        const at = matte.data[Math.min(matte.h - 1, Math.floor(y * matte.h)) * matte.w + Math.min(matte.w - 1, Math.floor(x * matte.w))] as number;
        if (masks && masks.length === 1 && at < 128) matte = { ...matte, data: matte.data.map((d) => 255 - d) };
        return { matte, how: 'ai' };
      }
    } finally {
      r.close();
    }
  }
  const ctx = pic.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  const px = ctx.getImageData(0, 0, pic.width, pic.height).data;
  return { matte: floodSelect(px, pic.width, pic.height, x * pic.width - 0.5, y * pic.height - 0.5, tolerance), how: 'color' };
}
