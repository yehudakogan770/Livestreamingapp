// Export a 3D logo as a video: every frame is drawn here (not in real time,
// so nothing is ever dropped) and sent to FFmpeg.

import type { EngineClient, VideoFormat } from '../engine/client';
import type { Logo3d } from '../engine/types/Logo3d';
import { Logo3dRenderer, loadLogo, placeholderLogo } from './renderer';
import { makeRenderer } from '../visuals/renderer';
import { VisualsPlayer } from '../visuals/player';
import { loopVisuals } from './background';

export interface ExportOptions {
  path: string;
  seconds: number;
  width: number;
  height: number;
  fps: number;
  format: VideoFormat;
}

/** Can this format keep a see-through background? */
export const keepsTransparency = (f: VideoFormat) => f !== 'mp4';

/**
 * Make the video. `onProgress` gets 0 – 1; `cancelled()` stops it (the
 * half-made file is removed). Resolves the file's path.
 */
export async function exportLogoVideo(
  client: EngineClient,
  logo: Logo3d,
  url: string | null,
  o: ExportOptions,
  onProgress: (done: number) => void,
  cancelled: () => boolean,
): Promise<string> {
  const prepared = url ? await loadLogo(url) : placeholderLogo();
  const fg = document.createElement('canvas');
  const r = Logo3dRenderer.create(fg);
  if (!r) throw new Error('This computer can’t draw 3D (WebGL is off).');
  r.setLogo(prepared);
  const bgCanvas = document.createElement('canvas');
  const loop = logo.background === 'loop' ? makeRenderer(bgCanvas) : null;
  const player = new VisualsPlayer();
  const out = document.createElement('canvas');
  out.width = o.width;
  out.height = o.height;
  const g = out.getContext('2d', { willReadFrequently: true })!;
  const frames = Math.max(1, Math.round(o.seconds * o.fps));
  const session = await client.exportStart({ path: o.path, width: o.width, height: o.height, fps: o.fps, format: o.format });
  try {
    for (let i = 0; i < frames; i++) {
      if (cancelled()) {
        await client.exportCancel(session);
        throw new Error('Export cancelled.');
      }
      const t = (i * 1000) / o.fps;
      g.clearRect(0, 0, o.width, o.height);
      if (logo.background === 'colour') {
        g.fillStyle = logo.bgColor;
        g.fillRect(0, 0, o.width, o.height);
      } else if (logo.background === 'loop' && loop) {
        loop.draw(player.frame(loopVisuals(logo.bgScene), t), o.width, o.height);
        g.drawImage(bgCanvas, 0, 0, o.width, o.height);
      } else if (!keepsTransparency(o.format)) {
        // MP4 can't be see-through: black behind.
        g.fillStyle = '#000';
        g.fillRect(0, 0, o.width, o.height);
      }
      r.draw(logo, t, o.width, o.height);
      g.drawImage(fg, 0, 0);
      await client.exportFrame(session, g.getImageData(0, 0, o.width, o.height).data);
      onProgress((i + 1) / frames);
    }
    return await client.exportFinish(session);
  } catch (e) {
    await client.exportCancel(session).catch(() => undefined);
    throw e;
  } finally {
    r.dispose();
    loop?.dispose();
  }
}
