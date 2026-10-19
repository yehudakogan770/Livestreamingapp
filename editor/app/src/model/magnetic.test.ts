import { describe, expect, it } from 'vitest';
import { Doc } from '../doc';
import { addMedia } from './build';
import { lift, moveClips, trim } from './edit';
import { magnetize, owners, packPrimary } from './magnetic';
import { current, editSeq, end, onTrack } from './seq';
import { DEFAULT_TEXT, emptyProject, newClip, type MediaItem, type Project } from './types';

const media: MediaItem = {
  id: 'm1',
  name: 'Clip',
  path: '/c.mp4',
  proxy: null,
  kind: 'video',
  duration: 100,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  bin: null,
};

/** Three 2-second clips with sound on V1 at 0, 60 and 120, and a title on V2 over the second. */
function project(magnetic = true): Project {
  let p: Project = { ...emptyProject('Test'), media: [media] };
  p = addMedia(p, 'm1', 0, 'overwrite', undefined, undefined, { in: 0, out: 2 });
  p = addMedia(p, 'm1', 60, 'overwrite', undefined, undefined, { in: 10, out: 12 });
  p = addMedia(p, 'm1', 120, 'overwrite', undefined, undefined, { in: 20, out: 22 });
  const s = current(p);
  const v2 = s.tracks[1]?.id as string;
  const title = { ...newClip(v2, 70, 30, { kind: 'text', text: { ...DEFAULT_TEXT } }, 'Title'), id: 'title' };
  return editSeq(p, (q) => ({ ...q, magnetic, clips: [...q.clips, title] }));
}
const v1 = (p: Project) => current(p).tracks[0]?.id as string;
const a1 = (p: Project) => current(p).tracks.find((t) => t.kind === 'audio')?.id as string;
const starts = (p: Project, track: string) => onTrack(current(p), track).map((c) => c.start);
const story = (p: Project) => onTrack(current(p), v1(p));

describe('magnetic timeline', () => {
  it('packs V1 and carries sound and titles with their clips', () => {
    const p = project();
    // Already without gaps: nothing changes.
    expect(packPrimary(current(p))).toBe(current(p));
    const gappy = editSeq(p, (x) => ({ ...x, clips: x.clips.map((c) => (c.start >= 60 && c.id !== 'title' ? { ...c, start: c.start + 30 } : c)) }));
    const g = current(gappy);
    const title = g.clips.find((c) => c.id === 'title');
    expect(title?.start).toBe(70);
    const packed = packPrimary(g);
    expect(onTrack(packed, v1(p)).map((c) => c.start)).toEqual([0, 60, 120]);
    // The title starts in the gap after the first clip, so it belongs to that clip and stays.
    expect(packed.clips.find((c) => c.id === 'title')?.start).toBe(70);
    expect(onTrack(packed, a1(p)).map((c) => c.start)).toEqual([0, 60, 120]);
  });

  it('closes the gap when a V1 clip is taken out, and the title on the next clip follows it', () => {
    const p = project();
    const second = story(p)[1]?.id as string;
    const doc = new Doc(p);
    doc.edit((x) => lift(x, [story(x)[0]?.id as string]), 'Clear');
    const q = doc.project;
    expect(starts(q, v1(q))).toEqual([0, 60]);
    expect(story(q)[0]?.id).toBe(second);
    // Its sound went with it, and the title on it moved back by the same 60 frames.
    expect(starts(q, a1(q))).toEqual([0, 60]);
    expect(current(q).clips.find((c) => c.id === 'title')?.start).toBe(10);
  });

  it('markers on a V1 clip move with it when the story closes up', () => {
    const p = editSeq(project(), (s) => ({ ...s, markers: [{ id: 'k', at: 90, length: 0, name: 'Speech', color: '#fff' }] }));
    const doc = new Doc(p);
    doc.edit((x) => lift(x, [story(x)[0]?.id as string]), 'Clear');
    expect(current(doc.project).markers[0]?.at).toBe(30);
  });

  it('dragging a V1 clip along reorders the story instead of covering', () => {
    const p = project();
    const [a, b, c] = story(p);
    const q = moveClips(p, [a?.id as string], { frames: 100, video: 0, audio: 0 });
    // Dropped past the middle of the second clip: it goes after it.
    expect(story(q).map((x) => x.id)).toEqual([b?.id, a?.id, c?.id]);
    expect(starts(q, v1(q))).toEqual([0, 60, 120]);
    expect(story(q).every((x) => x.length === 60)).toBe(true);
    // The title on the second clip moved back with it.
    expect(current(q).clips.find((x) => x.id === 'title')?.start).toBe(10);
    // Each clip's sound stayed under it.
    const sound = onTrack(current(q), a1(q));
    for (const v of story(q)) expect(sound.find((s) => s.link === v.link)?.start).toBe(v.start);
  });

  it('a trim on V1 ripples, so no gap opens', () => {
    const p = project();
    const first = story(p)[0]?.id as string;
    const q = trim(p, first, 'end', -20, 'normal');
    expect(starts(q, v1(q))).toEqual([0, 40, 100]);
    expect(current(q).clips.find((c) => c.id === 'title')?.start).toBe(50);
  });

  it('turning it on closes existing gaps in one step; off leaves gaps alone', () => {
    const p = project(false);
    const gappy = editSeq(p, (x) => ({ ...x, clips: x.clips.filter((c) => c.id !== story(p)[1]?.id) }));
    expect(starts(gappy, v1(gappy))).toEqual([0, 120]);
    const on = magnetize(
      gappy,
      editSeq(gappy, (x) => ({ ...x, magnetic: true })),
    );
    expect(starts(on, v1(on))).toEqual([0, 60]);
    const off = magnetize(
      gappy,
      editSeq(gappy, (x) => ({ ...x, clips: x.clips.slice(1) })),
    );
    expect(off).toEqual(editSeq(gappy, (x) => ({ ...x, clips: x.clips.slice(1) })));
  });

  it('connected clips that would overlap move up a track instead of being cut', () => {
    const p = project();
    const v2 = current(p).tracks[1]?.id as string;
    const other = { ...newClip(v2, 5, 40, { kind: 'color', color: '#ff0000' }, 'Red'), id: 'red' };
    const withRed = editSeq(p, (x) => ({ ...x, clips: [...x.clips, other] }));
    const doc = new Doc(withRed);
    // Taking out the first clip pulls the title back to 10, over the red clip (5–45, which stays where it is).
    doc.edit((x) => lift(x, [story(x)[0]?.id as string]), 'Clear');
    const s = current(doc.project);
    const title = s.clips.find((c) => c.id === 'title');
    const red = s.clips.find((c) => c.id === 'red');
    expect(red?.start).toBe(5);
    expect(red?.track).toBe(v2);
    expect(title?.start).toBe(10);
    expect(title?.track).toBe(current(p).tracks[2]?.id);
    for (const t of s.tracks) {
      const on = onTrack(s, t.id);
      for (let i = 1; i < on.length; i++) expect(on[i]?.start).toBeGreaterThanOrEqual(end(on[i - 1] as never));
    }
  });

  it('a clip put on V1 goes in at the nearest cut and pushes the story along', () => {
    const p = project();
    const q = addMedia(p, 'm1', 70, 'overwrite', undefined, undefined, { in: 40, out: 41 });
    expect(starts(q, v1(q))).toEqual([0, 60, 90, 150]);
    expect(story(q).map((c) => c.length)).toEqual([60, 30, 60, 60]);
    // The title on the clip that was pushed along moved with it.
    expect(current(q).clips.find((c) => c.id === 'title')?.start).toBe(100);
  });

  it('owners: linked sound by link, other clips by the V1 clip under their start', () => {
    const p = project();
    const s = current(p);
    const own = owners(s, v1(p));
    const second = story(p)[1]?.id;
    expect(own.get('title')).toBe(second);
  });
});
