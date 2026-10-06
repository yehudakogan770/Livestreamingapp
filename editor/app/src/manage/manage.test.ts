// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addMedia } from '../model/build';
import { current } from '../model/seq';
import { emptyProject, type MediaItem, type Project } from '../model/types';
import { archivePlan, keepSpan, mergeRanges, trimArgs, usedRanges } from './archive';
import { addShots, shotsFromCuts } from './shots';
import { allTags, parseTags, removeUnused, searchMatches, setMediaInfo, smartBinItems, usedMedia, usesOf, newSmartBin } from './smartbins';

const media = (id: string, over: Partial<MediaItem> = {}): MediaItem => ({
  id,
  name: id.toUpperCase(),
  path: `/shoot/${id}.mp4`,
  proxy: null,
  kind: 'video',
  duration: 100,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  bin: null,
  ...over,
});

/** “a” used twice (seconds 10–20 and 50–55), “b” used whole, “c” unused. */
function project(): Project {
  let p: Project = {
    ...emptyProject('Gala'),
    media: [media('a'), media('b', { duration: 8 }), media('c', { kind: 'audio', hasVideo: false, path: '/shoot/c.wav' })],
  };
  p = addMedia(p, 'a', 0, 'overwrite', undefined, undefined, { in: 10, out: 20 });
  p = addMedia(p, 'a', 300, 'overwrite', undefined, undefined, { in: 50, out: 55 });
  p = addMedia(p, 'b', 450, 'overwrite', undefined, undefined, { in: 0, out: 8 });
  return p;
}

describe('collect files / archive', () => {
  it('finds the parts of each file used', () => {
    const r = usedRanges(project());
    const a = (r.get('a') ?? []).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    // Picture and sound clips both use the same parts.
    expect(a).toEqual([
      [10, 20],
      [10, 20],
      [50, 55],
      [50, 55],
    ]);
    expect(r.has('c')).toBe(false);
  });

  it('joins parts with handles, inside the file', () => {
    expect(
      mergeRanges(
        [
          [10, 20],
          [21, 25],
          [50, 55],
        ],
        2,
        100,
      ),
    ).toEqual([
      [8, 27],
      [48, 57],
    ]);
    expect(mergeRanges([[0.5, 99.5]], 2, 100)).toEqual([[0, 100]]);
    expect(keepSpan([[10, 20]], 2, 100)).toEqual({ from: 8, to: 22 });
    // Nearly all of it: copied whole.
    expect(keepSpan([[1, 99]], 1, 100)).toBeNull();
  });

  it('copies whole files, or trims with handles and moves the clips to match', () => {
    const p = project();
    const whole = archivePlan(p, { folder: '/backup', name: 'Gala', trim: false, handles: 2, includeUnused: false });
    expect(whole.root).toBe('/backup/Gala');
    expect(whole.projectPath).toBe('/backup/Gala/Gala.lumoraedit');
    expect(whole.jobs).toEqual([
      { from: '/shoot/a.mp4', to: '/backup/Gala/Media/a.mp4', args: null },
      { from: '/shoot/b.mp4', to: '/backup/Gala/Media/b.mp4', args: null },
    ]);
    expect(whole.project.media.map((m) => m.path)).toEqual(['/backup/Gala/Media/a.mp4', '/backup/Gala/Media/b.mp4']);

    const trimmed = archivePlan(p, { folder: '/backup', name: 'Gala', trim: true, handles: 2, includeUnused: true });
    const a = trimmed.items.find((x) => x.path === '/shoot/a.mp4');
    expect(a?.trim?.from).toBeCloseTo(8);
    expect(a?.trim?.to).toBeCloseTo(57);
    expect(a?.dest).toBe('/backup/Gala/Media/a.mov');
    const job = trimmed.jobs.find((j) => j.from === '/shoot/a.mp4');
    expect(job?.args?.slice(0, 6)).toEqual(['-ss', '8', '-i', '{in}', '-t', '49']);
    // The short file and the unused one are copied whole.
    expect(trimmed.items.find((x) => x.path === '/shoot/b.mp4')?.trim).toBeNull();
    expect(trimmed.items.find((x) => x.path === '/shoot/c.wav')?.trim).toBeNull();
    // Clips now point 8 seconds earlier into the shorter file.
    const s = current(trimmed.project);
    const ins = s.clips.filter((c) => c.source.kind === 'media' && c.source.media === 'a').map((c) => (c.source.kind === 'media' ? Math.round(c.source.in) : -1));
    expect([...new Set(ins)].sort((x, y) => x - y)).toEqual([2, 42]);
    expect(trimmed.project.media.find((m) => m.id === 'a')?.duration).toBeCloseTo(49);
  });

  it('missing files are left out and named; names never clash', () => {
    const p = project();
    const q: Project = { ...p, media: [...p.media.map((m) => (m.id === 'b' ? { ...m, missing: true } : m)), media('d', { path: '/other/a.mp4' })] };
    const plan = archivePlan(q, { folder: '/x', name: 'G/a:la', trim: false, handles: 0, includeUnused: true });
    expect(plan.missing).toEqual(['B']);
    expect(plan.root).toBe('/x/G_a_la');
    expect(plan.jobs.map((j) => j.to)).toEqual(['/x/G_a_la/Media/a.mp4', '/x/G_a_la/Media/c.wav', '/x/G_a_la/Media/a (2).mp4']);
  });

  it('sound is trimmed to WAV, deep video to ProRes', () => {
    expect(trimArgs(media('c', { kind: 'audio', hasVideo: false }), { from: 1, to: 3 }).ext).toBe('wav');
    const deep = trimArgs(
      media('p', { source: { codec: 'prores', bitDepth: 10, hdr: false, rotation: 0, vfr: false, bitrateKbps: 0, heavy: false, exportVia: 'ffmpeg' } }),
      { from: 0, to: 1 },
    );
    expect(deep.args).toContain('prores_ks');
  });
});

describe('scene detection', () => {
  it('makes shots between cuts, joining very short ones', () => {
    expect(shotsFromCuts(30, [10, 20])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(shotsFromCuts(30, [10, 10.4, 29.6, 45, -1])).toEqual([
      [0, 10],
      [10, 30],
    ]);
    expect(shotsFromCuts(30, [])).toEqual([[0, 30]]);
    expect(shotsFromCuts(0, [1])).toEqual([]);
  });

  it('adds the shots as subclips in a bin of their own', () => {
    const p = addShots(project(), 'a', [
      [0, 40],
      [40, 100],
    ]);
    const subs = p.media.filter((m) => m.range);
    expect(subs.map((m) => m.range)).toEqual([
      [0, 40],
      [40, 100],
    ]);
    expect(subs.every((m) => m.path === '/shoot/a.mp4' && m.bin === p.bins[p.bins.length - 1]?.id)).toBe(true);
    expect(p.bins[p.bins.length - 1]?.name).toBe('A · shots');
    // A subclip goes on the timeline as just its part.
    const sub = subs[1] as MediaItem;
    const placed = addMedia(p, sub.id, 900, 'overwrite');
    const c = current(placed).clips.find((x) => x.source.kind === 'media' && x.source.media === sub.id);
    expect(c?.source.kind === 'media' && c.source.in).toBe(40);
    expect(c?.length).toBe(60 * 30);
  });
});

describe('finding media', () => {
  it('searches names, tags, notes and what is said', () => {
    const m = media('a', { tags: ['interview'], notes: 'Great light', transcript: { language: 'en', model: 'x', words: [{ w: 'Welcome', s: 0, e: 1 }], done: [] } });
    expect(searchMatches(m, '')).toBe(true);
    expect(searchMatches(m, '#interview')).toBe(true);
    expect(searchMatches(m, 'great LIGHT')).toBe(true);
    expect(searchMatches(m, 'welcome')).toBe(true);
    expect(searchMatches(m, 'welcome nope')).toBe(false);
  });

  it('smart bins by type, rating, tag, resolution, date, transcript and use', () => {
    const now = 1_000_000_000;
    let p = project();
    p = setMediaInfo(p, 'a', { rating: 4, tags: ['Interview'] });
    p = { ...p, media: p.media.map((m) => (m.id === 'b' ? { ...m, width: 3840, height: 2160, addedAt: now - 3600_000 } : m)) };
    const names = (rules: Parameters<typeof newSmartBin>[1], match: 'all' | 'any' = 'all') => smartBinItems(p, newSmartBin('x', rules, match), now).map((m) => m.id);
    expect(names([{ field: 'kind', is: 'audio' }])).toEqual(['c']);
    expect(names([{ field: 'rating', atLeast: 3 }])).toEqual(['a']);
    expect(names([{ field: 'tag', has: 'interview' }])).toEqual(['a']);
    expect(names([{ field: 'resolution', atLeast: 2160 }])).toEqual(['b']);
    expect(names([{ field: 'added', withinDays: 1 }])).toEqual(['b']);
    expect(names([{ field: 'transcript', has: false }])).toEqual(['a', 'b', 'c']);
    expect(names([{ field: 'used', is: false }])).toEqual(['c']);
    expect(
      names(
        [
          { field: 'rating', atLeast: 4 },
          { field: 'kind', is: 'audio' },
        ],
        'any',
      ),
    ).toEqual(['a', 'c']);
    expect(
      names([
        { field: 'rating', atLeast: 4 },
        { field: 'kind', is: 'audio' },
      ]),
    ).toEqual([]);
    expect(names([])).toEqual(['a', 'b', 'c']);
  });

  it('where a file is used, removing unused media, and tags', () => {
    const p = project();
    expect([...usedMedia(p)].sort()).toEqual(['a', 'b']);
    const uses = usesOf(p, 'a');
    expect(uses.map((u) => u.start)).toEqual([0, 0, 300, 300]);
    const r = removeUnused(p);
    expect(r.removed).toBe(1);
    expect(r.project.media.map((m) => m.id)).toEqual(['a', 'b']);
    expect(parseTags('interview, b roll #exterior,,interview')).toEqual(['interview', 'b-roll', 'exterior']);
    expect(allTags(setMediaInfo(setMediaInfo(p, 'a', { tags: ['x', 'y'] }), 'b', { tags: ['y'] }))).toEqual(['y', 'x']);
  });
});
