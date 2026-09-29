// Snapshot: a still picture of what a screen shows right now.

import type { EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { ProgramCompositor } from './compositor';

/** Draw the screen as the audience sees it and return a PNG. */
export async function snapshot(client: EngineClient, show: Show, screen: 'live' | 'back', width = 1920, height = 1080): Promise<Blob> {
  const c = new ProgramCompositor(client, width, height, screen);
  c.setShow(show);
  try {
    // Pictures and videos load over a few frames: draw until they are in.
    for (let i = 0; i < 20; i++) {
      c.draw(Date.now());
      await new Promise((r) => setTimeout(r, 40));
    }
    c.draw(Date.now());
    return await new Promise<Blob>((resolve, reject) =>
      c.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'),
    );
  } finally {
    c.dispose();
  }
}

/** A file name for a snapshot: "Live Screen 2026-09-29 21.14.05.png". */
export function snapshotName(screen: 'live' | 'back', at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${screen === 'live' ? 'Live Screen' : 'Back Screen'} ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}.${p(at.getMinutes())}.${p(at.getSeconds())}.png`;
}
