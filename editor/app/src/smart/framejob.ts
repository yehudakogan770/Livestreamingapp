// Framing a vertical or square sequence on the people in it: faces looked for
// every few frames of each picture clip, and the picture following them
// smoothly (Auto reframe's way), as keyframed position.
import type { Clip, Project, Sequence } from '../model/types';
import { check, type Job } from './analysis';
import { withMotions } from './clips';
import type { FaceFinder } from './detect';
import { framedClips, REFRAME_DEFAULTS, reframeMotion, sampleTimes, type Aspect } from './reframe';

export async function frameOnFaces(p: Project, seqId: string, aspect: Aspect, finder: FaceFinder, job: Job, report?: (done: number) => void): Promise<Project> {
  const s = p.sequences.find((x) => x.id === seqId) as Sequence | undefined;
  if (!s) return p;
  const motions = new Map<string, Clip['motion']>();
  const framed = framedClips(p, s);
  for (const [k, { clip, media }] of framed.entries()) {
    check(job);
    const { t, seconds } = sampleTimes(p, clip, s, REFRAME_DEFAULTS.every);
    const looked = await finder.look(media.proxy ?? media.path, seconds, (d) => report?.((k + d) / Math.max(1, framed.length)));
    const samples = t.map((frame, n) => ({ t: frame, found: looked[n] ?? [] }));
    if (samples.some((x) => x.found.length))
      motions.set(clip.id, reframeMotion(clip, media, { w: s.width, h: s.height }, samples, { ...REFRAME_DEFAULTS, aspect }));
  }
  return withMotions(p, seqId, motions);
}
