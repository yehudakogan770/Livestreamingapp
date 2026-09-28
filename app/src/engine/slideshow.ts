// Slideshows (mirrors crates/engine/src/slideshow.rs), and turning a PDF
// into picture slides.

import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';
import type { Slideshow } from './types/Slideshow';

export function defaultSlideshow(): Slideshow {
  return {
    slides: [],
    current: 0,
    changedAt: 0,
    autoMs: null,
    looping: true,
    area: { x: 0, y: 0, w: 100, h: 100 },
    fit: 'contain',
    background: '#000000',
    behind: null,
    fade: true,
  };
}

/** Where the slides sit: ready-made areas (the rest shows what is behind). */
export const AREAS = [
  { name: 'Whole screen', frame: { x: 0, y: 0, w: 100, h: 100 } },
  { name: 'Left two-thirds', frame: { x: 2, y: 8, w: 64, h: 84 } },
  { name: 'Right two-thirds', frame: { x: 34, y: 8, w: 64, h: 84 } },
  { name: 'Top, over a bar', frame: { x: 10, y: 3, w: 80, h: 76 } },
];

export function nextSlideIndex(sh: Slideshow): number | null {
  if (sh.current + 1 < sh.slides.length) return sh.current + 1;
  return sh.looping && sh.slides.length > 1 ? 0 : null;
}

export function slideDue(sh: Slideshow, now: number): boolean {
  return sh.autoMs !== null && now >= sh.changedAt + sh.autoMs && nextSlideIndex(sh) !== null;
}

/** The slideshow on air (or in Next) on this screen. */
export function slideshowTarget(show: Show, screen: ScreenId): { id: string; where: 'onAir' | 'next'; sh: Slideshow } | null {
  if (screen === 'monitor') return null;
  const sc = show.screens[screen];
  for (const [id, where] of [
    [sc.program, 'onAir'],
    [sc.preview, 'next'],
  ] as const) {
    const k = show.sources.find((s) => s.id === id)?.kind;
    if (id && k?.type === 'slideshow') return { id, where, sh: k };
  }
  return null;
}

/**
 * Turn each page of a PDF into a picture (1920 px wide), calling `save` with
 * each one in order. `onPage` reports progress.
 */
export async function pdfToPictures(
  data: ArrayBuffer,
  save: (png: Blob, page: number) => Promise<string>,
  onPage?: (n: number, of: number) => void,
): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const paths: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onPage?.(n, doc.numPages);
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1920 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('this computer cannot draw the page');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('page could not be drawn'))), 'image/png'),
    );
    paths.push(await save(png, n));
  }
  await task.destroy();
  return paths;
}
