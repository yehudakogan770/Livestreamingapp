import { describe, expect, it } from 'vitest';
import { emptyProject, newClip, type MediaItem, type Project, type Sequence } from '../model/types';
import { mediaDistance, nextJob, proxySlots, ProxyScheduler, threadsFor, type ProxyJob } from './proxyqueue';

const media = (id: string): MediaItem => ({
  id,
  name: id,
  path: `/m/${id}.mov`,
  proxy: null,
  kind: 'video',
  duration: 600,
  width: 3840,
  height: 2160,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  bin: null,
});

/** a at 0–100, b at 500–600, c at 1000–1100; d is in the bin only. */
function project(): Project {
  const p = emptyProject('t');
  const s = p.sequences[0] as Sequence;
  const v1 = s.tracks[0]!.id;
  const clip = (m: string, start: number) => newClip(v1, start, 100, { kind: 'media', media: m, in: 0 }, m);
  return { ...p, media: ['a', 'b', 'c', 'd'].map(media), sequences: [{ ...s, clips: [clip('a', 0), clip('b', 500), clip('c', 1000)] }] };
}

const job = (id: string, urgent = false): ProxyJob => ({ id, path: `/m/${id}.mov`, urgent });

describe('proxy scheduling', () => {
  it('measures how far each file is from the playhead', () => {
    const p = project();
    expect(mediaDistance(p, 'b', 550)).toBe(0);
    expect(mediaDistance(p, 'c', 550)).toBe(450);
    // Behind the playhead counts double.
    expect(mediaDistance(p, 'a', 550)).toBe((550 - 100 + 1) * 2);
    expect(mediaDistance(p, 'd', 550)).toBe(Infinity);
  });

  it('starts with the file under the playhead, then the nearest, unused files last', () => {
    const p = project();
    const jobs = ['d', 'a', 'c', 'b'].map((id) => job(id));
    const order: string[] = [];
    const left = [...jobs];
    while (left.length) {
      const j = nextJob(left, p, 550) as ProxyJob;
      order.push(j.id);
      left.splice(left.indexOf(j), 1);
    }
    expect(order).toEqual(['b', 'c', 'a', 'd']);
    // At the start of the timeline.
    expect(nextJob(jobs, p, 0)?.id).toBe('a');
    // Asked for by hand: first, even unused.
    expect(nextJob([...jobs, job('d', true)].slice(1), p, 550)?.id).toBe('d');
    // No project: in the order they came.
    expect(nextJob(jobs, null, 0)?.id).toBe('d');
  });

  it('runs a few at a time, each with its share of the cores', () => {
    expect(proxySlots(4)).toBe(1);
    expect(proxySlots(8)).toBe(2);
    expect(proxySlots(16)).toBe(4);
    expect(proxySlots(64)).toBe(4);
    expect(proxySlots(NaN)).toBe(1);
    expect(threadsFor(16, 4)).toBe(4);
    expect(threadsFor(2, 1)).toBe(2);
  });

  it('keeps at most its slots busy and picks the most useful next', async () => {
    const p = project();
    let playhead = 550;
    const started: string[] = [];
    let live = 0;
    let peak = 0;
    const done: Record<string, () => void> = {};
    const q = new ProxyScheduler(
      (j, threads) => {
        expect(threads).toBe(4);
        started.push(j.id);
        live++;
        peak = Math.max(peak, live);
        return new Promise<void>((r) => {
          done[j.id] = () => {
            live--;
            r();
          };
        });
      },
      () => ({ p, playhead }),
      8,
    );
    expect(q.slots).toBe(2);
    q.add(['d', 'a', 'c', 'b'].map((id) => job(id)));
    expect(started).toEqual(['b', 'c']);
    expect(q.has('a') && q.has('b')).toBe(true);
    // The same file again is not queued twice.
    q.add([job('a')]);
    expect(q.queued).toBe(2);
    // The playhead moves to the start: a is next.
    playhead = 0;
    done.b?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['b', 'c', 'a']);
    done.c?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['b', 'c', 'a', 'd']);
    done.a?.();
    done.d?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(peak).toBe(2);
    expect(q.busy).toBe(0);
    expect(q.has('a')).toBe(false);
  });
});
