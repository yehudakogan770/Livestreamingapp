// On the show computer, in the Standard engine: small pictures and the
// mixer's levels for the seats, made from what the control window already
// shows. Only what a seat is watching, a couple of times a second; nothing
// at all while no seat is connected. (The Unified engine sends its own
// pictures straight from the graphics card.)

import { useEffect } from 'react';
import { useSound } from '../audio/SoundContext';
import { unifiedOn } from '../engine/unified';
import { feedApi } from './api';

const WIDTH = 320;
const HEIGHT = 180;
const PICTURES_EVERY_MS = 500;
const METERS_EVERY_MS = 100;

/** Where the control window shows each key (only the screen being controlled is on view). */
export function elementFor(key: string, root: ParentNode = document): Element | null {
  const [kind, id] = key.split('/');
  if (!id) return null;
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
  if (kind === 'program') return root.querySelector(`.mon--pgm [data-screen="${esc}"]`);
  if (kind === 'next') return root.querySelector(`.mon--pvw [data-screen="${esc}"]`);
  if (kind === 'source') return root.querySelector(`[data-seat-source="${esc}"]`);
  return null;
}

/**
 * Draw the pictures inside `el` (cameras, videos, pictures, canvases) where
 * they sit, onto a small canvas. Words and shapes drawn with HTML are left out.
 */
export function drawElement(el: Element, canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const box = el.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / box.width;
  const sy = canvas.height / box.height;
  let drew = false;
  for (const m of Array.from(el.querySelectorAll('video, img, canvas'))) {
    const r = m.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (m instanceof HTMLVideoElement && m.readyState < 2) continue;
    if (m instanceof HTMLImageElement && !m.complete) continue;
    try {
      ctx.drawImage(m as CanvasImageSource, (r.left - box.left) * sx, (r.top - box.top) * sy, r.width * sx, r.height * sy);
      drew = true;
    } catch {
      // Not drawable (yet): skip it.
    }
  }
  return drew;
}

async function jpeg(canvas: HTMLCanvasElement): Promise<ArrayBuffer | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/jpeg', 0.6);
    } catch {
      // A picture from elsewhere marked the canvas as not readable.
      resolve(null);
    }
  });
  return blob ? blob.arrayBuffer() : null;
}

/** Feeds the seats; render it inside the control window's sound provider. */
export function SeatFeed() {
  const sound = useSound();
  useEffect(() => {
    let watched: string[] = [];
    let stopped = false;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ask = setInterval(() => {
      void feedApi.watched().then(
        (w) => (watched = w),
        () => (watched = []),
      );
    }, 1000);
    const pictures = setInterval(() => {
      if (stopped || unifiedOn()) return;
      for (const key of watched) {
        if (key === 'meters') continue;
        const el = elementFor(key);
        if (!el || !drawElement(el, canvas)) continue;
        void jpeg(canvas).then((b) => b && !stopped && feedApi.picture(key, b).catch(() => {}));
      }
    }, PICTURES_EVERY_MS);
    const meters = setInterval(() => {
      if (stopped || !sound || !watched.includes('meters')) return;
      const levels: Record<string, number> = {};
      for (const [id, v] of sound.levels) levels[id] = Math.round(v * 1000) / 1000;
      void feedApi.meters(levels).catch(() => {});
    }, METERS_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(ask);
      clearInterval(pictures);
      clearInterval(meters);
    };
  }, [sound]);
  return null;
}
