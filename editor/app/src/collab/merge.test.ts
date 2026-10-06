import { describe, expect, it } from 'vitest';
import { emptyProject, newClip, newSequence, type MediaItem, type Project, type Sequence } from '../model/types';
import { bringIn, changedSequences, conflicts, diff, forUpload, merge, realChange } from './merge';
import { applyLinks, linksFrom } from './links';

const media = (id: string, path: string): MediaItem => ({
  id,
  name: id,
  path,
  proxy: null,
  kind: 'video',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  bin: null,
});

/** A project with two sequences and one media file. */
function base(): Project {
  const p = emptyProject('Film');
  const s2 = { ...newSequence('Sequence 2'), id: 's2' };
  const s1 = { ...(p.sequences[0] as Sequence), id: 's1' };
  return { ...p, sequences: [s1, s2], open: 's1', media: [media('m1', 'C:/mine/a.mp4')] };
}
const seq = (p: Project, id: string) => p.sequences.find((s) => s.id === id) as Sequence;
const withSeq = (p: Project, id: string, f: (s: Sequence) => Sequence): Project => ({ ...p, sequences: p.sequences.map((s) => (s.id === id ? f(s) : s)) });
const addClip = (p: Project, id: string, name: string) =>
  withSeq(p, id, (s) => ({ ...s, clips: [...s.clips, newClip(s.tracks[0]!.id, 0, 30, { kind: 'color', color: '#fff' }, name)] }));

describe('merging two saves', () => {
  it('joins changes to different sequences', () => {
    const b = base();
    const mine = addClip(b, 's1', 'mine');
    const theirs = addClip(b, 's2', 'theirs');
    const m = merge(b, mine, theirs);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(seq(m.project, 's1').clips.map((c) => c.name)).toEqual(['mine']);
    expect(seq(m.project, 's2').clips.map((c) => c.name)).toEqual(['theirs']);
  });

  it('is a conflict when both change the same sequence differently', () => {
    const b = base();
    const m = merge(b, addClip(b, 's1', 'mine'), addClip(b, 's1', 'theirs'));
    expect(m).toEqual({ ok: false, conflicts: ['Sequence “Sequence 1”'] });
  });

  it('is not a conflict when both made the same change', () => {
    const b = base();
    const same = withSeq(b, 's1', (s) => ({ ...s, background: '#ff0000' }));
    const theirs = withSeq(b, 's1', (s) => ({ ...s, background: '#ff0000' }));
    expect(merge(b, same, theirs).ok).toBe(true);
  });

  it('ignores the playhead, the open sequence and where files are', () => {
    const b = base();
    const mine = { ...withSeq(b, 's1', (s) => ({ ...s, playhead: 500 })), open: 's2', media: [media('m1', 'D:/copies/a.mp4')] };
    const theirs = withSeq(b, 's1', (s) => ({ ...s, playhead: 90 }));
    expect(conflicts(b, mine, theirs)).toEqual([]);
    expect(realChange(b, mine)).toBe(false);
    expect(changedSequences(b, mine)).toEqual([]);
  });

  it('sees a removal against a change as a conflict', () => {
    const b = base();
    const mine = { ...b, sequences: b.sequences.filter((s) => s.id !== 's2') };
    const theirs = addClip(b, 's2', 'theirs');
    expect(conflicts(b, mine, theirs)).toEqual(['Sequence “Sequence 2”']);
  });

  it('brings in their new media and removals, keeping my file places', () => {
    const b = base();
    const mine = { ...b, media: [media('m1', 'D:/copies/a.mp4')] };
    const theirs = { ...b, name: 'Film 2', media: [{ ...media('m1', 'C:/mine/a.mp4'), name: 'Renamed' }, media('m2', 'C:/theirs/b.mp4')] };
    const out = bringIn(mine, diff(b, theirs));
    expect(out.name).toBe('Film 2');
    expect(out.media.map((m) => [m.id, m.name, m.path])).toEqual([
      ['m1', 'Renamed', 'D:/copies/a.mp4'],
      ['m2', 'm2', 'C:/theirs/b.mp4'],
    ]);
    const gone = bringIn(out, diff(theirs, { ...theirs, sequences: theirs.sequences.filter((s) => s.id !== 's1') }));
    expect(gone.sequences.map((s) => s.id)).toEqual(['s2']);
    expect(gone.open).toBe('s2');
  });
});

describe('what stays on one computer', () => {
  it('never shares, compares or brings in playback proxies', () => {
    const b = base();
    const mine = { ...b, media: [{ ...media('m1', 'C:/mine/a.mp4'), playbackProxy: 'C:/cache/a-proxy.mp4' }] };
    // Making a proxy here is not a change to put online, nor a conflict with someone renaming the file.
    expect(realChange(b, mine)).toBe(false);
    const theirs = {
      ...b,
      media: [
        { ...media('m1', 'C:/mine/a.mp4'), name: 'Renamed', playbackProxy: 'E:/their-cache/a.mp4' },
        { ...media('m2', 'E:/b.mp4'), playbackProxy: 'E:/their-cache/b.mp4' },
      ],
    };
    expect(conflicts(b, mine, theirs)).toEqual([]);
    const out = bringIn(mine, diff(b, theirs));
    expect(out.media.map((m) => [m.name, m.playbackProxy ?? null])).toEqual([
      ['Renamed', 'C:/cache/a-proxy.mp4'],
      ['m2', null],
    ]);
    expect(forUpload(mine, b).media[0]).not.toHaveProperty('playbackProxy');
  });
});

describe('smart bins', () => {
  const bin = { id: 'sb1', name: 'Five stars', match: 'all' as const, rules: [{ field: 'rating' as const, atLeast: 5 }] };
  it('are shared like bins', () => {
    const b = base();
    const theirs = { ...b, smartBins: [bin] };
    expect(realChange(b, theirs)).toBe(true);
    expect(bringIn(b, diff(b, theirs)).smartBins).toEqual([bin]);
    const mine = { ...b, smartBins: [{ ...bin, name: 'Best' }] };
    expect(conflicts(b, mine, theirs)).toEqual(['Smart bin “Best”']);
  });
});

describe('file places', () => {
  it('uploads the shared place for media that was shared already', () => {
    const b = base();
    const mine = { ...b, media: [{ ...media('m1', 'D:/copies/a.mp4'), missing: true }, media('m2', 'D:/new.mp4')] };
    const up = forUpload(mine, b);
    expect(up.media.map((m) => m.path)).toEqual(['C:/mine/a.mp4', 'D:/new.mp4']);
    expect(up.media[0]).not.toHaveProperty('missing');
  });

  it('remembers files found here and puts them back', () => {
    const shared = base();
    const local = { ...shared, media: [media('m1', 'D:/copies/a.mp4')] };
    const links = linksFrom(local, shared);
    expect(links).toEqual({ m1: { path: 'D:/copies/a.mp4', proxy: null } });
    expect(applyLinks(shared, links).media[0]?.path).toBe('D:/copies/a.mp4');
    expect(linksFrom(shared, shared, links)).toEqual({});
  });
});
