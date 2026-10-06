// The output windows' side of the test event: when the test asks, an output
// window measures how it draws (frames a second), whether it shows what is on
// air, whether the picture is black, and whether overlays and tally show —
// and answers. Does nothing until asked, and nothing outside Lumora.

import { useEffect, useRef } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { isInsideLumora } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { OutputName } from './verdict';

export const PROBE_EVENT = 'test-event-probe';
export const PROBE_RESULT = 'test-event-probe-result';

export interface ProbeAsk {
  id: number;
  ms: number;
}

export interface ProbeAnswer {
  id: number;
  output: OutputName;
  fps: number;
  inSync: boolean | null;
  black: boolean | null;
  overlays: boolean | null;
  tally: boolean | null;
  width: number;
  height: number;
}

/** Average brightness (0 – 255) of a picture element, or null if it can't be read. */
export function brightness(el: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): number | null {
  try {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(el, 0, 0, 32, 18);
    const d = g.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    return sum / (d.length / 4);
  } catch {
    // A picture from another origin can't be read: no answer rather than a wrong one.
    return null;
  }
}

/** Looks at this window's page: in step with Program, black, overlays, tally. */
export function inspect(output: OutputName, show: Show | null, root: ParentNode = document): Omit<ProbeAnswer, 'id' | 'fps' | 'width' | 'height'> {
  if (output === 'multiview') {
    const pgm = root.querySelector('.mv__box--pgm');
    return { output, inSync: null, black: null, overlays: null, tally: show?.screens.live.program ? !!pgm : null };
  }
  if (output === 'monitor') return { output, inSync: !!root.querySelector('[data-monitor]'), black: null, overlays: null, tally: null };
  const sc = show?.screens[output];
  const program = sc?.program ?? null;
  const screenEl = root.querySelector(`[data-screen="${output}"]`);
  const layer = program && screenEl ? screenEl.querySelector(`[data-layer="${CSS.escape(program)}"]`) : null;
  const inSync = program ? !!layer : screenEl ? true : null;
  let black: boolean | null = null;
  if (layer && !sc?.blank && !show?.panic) {
    const pic = layer.querySelector<HTMLVideoElement | HTMLCanvasElement | HTMLImageElement>('video, canvas, img');
    const b = pic ? brightness(pic) : null;
    black = b === null ? null : b < 3;
  }
  const wanted = !!show?.overlays.some((o) => o.on && o.sourceId && o.screens.includes(output));
  return { output, inSync, black, overlays: wanted ? !!root.querySelector('[data-overlay]') : null, tally: null };
}

/** Frames drawn in `ms`, per second. */
function countFrames(ms: number): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = (t: number) => {
      frames++;
      if (t - start < ms) requestAnimationFrame(tick);
      else resolve(Math.round((frames / ((t - start) / 1000)) * 10) / 10);
    };
    requestAnimationFrame(tick);
  });
}

/** In an output window: answer the test event's questions. */
export function useTestProbe(output: OutputName | null, show: Show | null | undefined): void {
  const showRef = useRef(show ?? null);
  showRef.current = show ?? null;
  useEffect(() => {
    if (!output || !isInsideLumora()) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void listen<ProbeAsk>(PROBE_EVENT, (e) => {
      const { id, ms } = e.payload;
      void countFrames(Math.min(Math.max(ms, 500), 5000)).then((fps) => {
        const answer: ProbeAnswer = { id, fps, width: window.innerWidth, height: window.innerHeight, ...inspect(output, showRef.current) };
        void emit(PROBE_RESULT, answer);
      });
    }).then((u) => {
      if (cancelled) u();
      else stop = u;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [output]);
}
