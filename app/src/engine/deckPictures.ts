// Small pictures of the inputs for control surfaces (the Stream Deck's input
// keys show what each input shows). The unified engine draws its own; with
// the Standard engine this window draws the ones a control surface asked for
// lately — once a second, small, only while asked — and hands them to the
// remote server (src-tauri/src/remote.rs, `/api/picture`).

import { useEffect, useRef } from 'react';
import { ProgramCompositor } from '../broadcast/compositor';
import type { EngineClient } from './client';
import type { Show } from './types/Show';
import { unifiedOn } from './unified';

/** The pictures' size: a Stream Deck key is 144 × 144, the picture fills its width. */
export const PICTURE_W = 240;
export const PICTURE_H = 135;
/** How often the pictures are drawn. */
export const PICTURE_MS = 1000;
/** The drawing canvas is let go after this long with nothing asked for. */
const IDLE_MS = 30_000;

export interface PictureDrawer {
  setShow(show: Show): void;
  drawInputs(ids: string[], now: number, took: (id: string) => void): void;
  readonly canvas: HTMLCanvasElement;
  dispose(): void;
}

/** One round: draw what is wanted (or nothing) and hand it in. Returns whether anything was wanted. */
export async function drawWanted(
  client: EngineClient,
  show: Show | null,
  drawer: () => PictureDrawer,
  opts: { skipCameras: boolean; now?: number },
): Promise<boolean> {
  const wanted = await client.picturesWanted();
  if (!wanted.length || !show) return wanted.length > 0;
  // With the unified engine running, cameras come from the engine: this window never opens one.
  const ids = wanted.filter((id) => {
    const src = show.sources.find((s) => s.id === id);
    return !!src && !(opts.skipCameras && src.kind.type === 'camera');
  });
  if (!ids.length) return true;
  const d = drawer();
  d.setShow(show);
  const shots: Promise<void>[] = [];
  d.drawInputs(ids, opts.now ?? Date.now(), (id) => {
    shots.push(
      new Promise<Blob | null>((resolve) => d.canvas.toBlob(resolve, 'image/jpeg', 0.72))
        .then((jpeg) => (jpeg ? client.putPicture(id, jpeg) : undefined))
        .catch(() => {}),
    );
  });
  await Promise.all(shots);
  return true;
}

/** Keep drawing the inputs' pictures control surfaces ask for, from this window. */
export function useDeckPictures(show: Show | null, client: EngineClient): void {
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    if (!client.live) return;
    let drawer: ProgramCompositor | null = null;
    let lastWanted = 0;
    let busy = false;
    const make = () => (drawer ??= new ProgramCompositor(client, PICTURE_W, PICTURE_H));
    const id = setInterval(() => {
      if (busy) return;
      busy = true;
      void drawWanted(client, showRef.current, make, { skipCameras: unifiedOn() })
        .then((any) => {
          const now = Date.now();
          if (any) lastWanted = now;
          else if (drawer && now - lastWanted > IDLE_MS) {
            drawer.dispose();
            drawer = null;
          }
        })
        .catch(() => {})
        .finally(() => (busy = false));
    }, PICTURE_MS);
    return () => {
      clearInterval(id);
      drawer?.dispose();
    };
  }, [client]);
}
