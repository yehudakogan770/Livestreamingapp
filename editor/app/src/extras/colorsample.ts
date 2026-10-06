// The pixels Auto color match looks at: a few frames of a clip, small, as
// they look after the clip's grade (so a match goes on top of what is there),
// with skin marked where the person model finds people (or by color alone).
import { check, type Job } from '../smart/analysis';
import { hexToRgb } from '../render/color';
import { mediaOf, rate, sourceTime } from '../model/seq';
import type { Clip, Project, Sequence } from '../model/types';
import { FrameReader, lookSize } from '../vision/frames';
import { canvasOf, segmentPerson } from '../vision/segment';
import { graded, joinPixels, makePixels, skinColor, type Pixels } from './colormatch';

/** Frames looked at in a clip, and their size (long side). */
const FRAMES = 5;
const LONG = 96;

/** The file time of a frame of a clip (multicam: the angle's own file). */
function fileTime(p: Project, c: Clip, into: number, fps: number): number {
  const t = sourceTime(c, into, fps);
  if (c.source.kind !== 'multicam') return t;
  const src = c.source;
  const angle = p.groups.find((g) => g.id === src.group)?.angles.find((a) => a.id === src.angle);
  return t - (angle?.offset ?? 0);
}

/** A clip's pixels (null when its picture can't be read). */
export async function clipPixels(p: Project, s: Sequence, c: Clip, skin: boolean, job: Job): Promise<Pixels | null> {
  const fps = rate(s);
  const aspect = s.width / Math.max(1, s.height);
  if (c.source.kind === 'color') {
    const px = makePixels(1);
    px.rgb.set(hexToRgb(c.source.color));
    return px;
  }
  const m = mediaOf(p, c);
  if (!m || (m.kind !== 'video' && m.kind !== 'image') || !m.hasVideo) return null;
  const into = Array.from({ length: FRAMES }, (_, i) => Math.round(((i + 0.5) / FRAMES) * Math.max(0, c.length - 1)));
  const times = into.map((f) => Math.max(0, Math.min(Math.max(0, m.duration - 0.05), fileTime(p, c, f, fps))));
  const order = times.map((t, i) => [t, i] as const).sort((a, b) => a[0] - b[0]);
  const [w, h] = lookSize(m.width, m.height, LONG);
  const frames: Pixels[] = [];
  await new FrameReader(m).each(
    order.map(([t]) => t),
    async (k, pic) => {
      check(job);
      if (!pic) return;
      const c2 = canvasOf(pic, w, h);
      const data = (c2.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(0, 0, w, h).data;
      const px = makePixels(w * h);
      for (let i = 0; i < w * h; i++) {
        px.rgb[i * 3] = (data[i * 4] as number) / 255;
        px.rgb[i * 3 + 1] = (data[i * 4 + 1] as number) / 255;
        px.rgb[i * 3 + 2] = (data[i * 4 + 2] as number) / 255;
        px.uv[i * 2] = ((i % w) + 0.5) / w;
        px.uv[i * 2 + 1] = (Math.floor(i / w) + 0.5) / h;
      }
      if (skin) {
        const [mw, mh] = lookSize(m.width, m.height, 320);
        const matte = await segmentPerson(canvasOf(pic, mw, mh)).catch(() => null);
        for (let i = 0; i < w * h; i++) {
          const rgb: [number, number, number] = [px.rgb[i * 3] as number, px.rgb[i * 3 + 1] as number, px.rgb[i * 3 + 2] as number];
          let person = true;
          if (matte) {
            const x = Math.min(matte.w - 1, Math.floor(((i % w) / w) * matte.w));
            const y = Math.min(matte.h - 1, Math.floor((Math.floor(i / w) / h) * matte.h));
            person = (matte.data[y * matte.w + x] as number) > 128;
          }
          px.skin[i] = person && skinColor(rgb) ? 1 : 0;
        }
      }
      const frame = into[order[k]?.[1] ?? 0] ?? 0;
      frames.push(graded(c, px, frame, aspect));
      job.progress((frames.length / FRAMES) * 0.9, `Looking at ${c.name}…`);
    },
  );
  check(job);
  return frames.length ? joinPixels(frames) : null;
}
