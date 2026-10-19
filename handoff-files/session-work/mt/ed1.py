import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac0904ea439c0efa9/editor/app/src/extras')
p = 'search.ts'
s = open(p).read()
s = s.replace("import type { MediaItem } from '../model/types';", "import { newClip, newSequence, uid, type Clip, type MediaItem, type Project } from '../model/types';\nimport { current } from '../model/seq';")
s += '''
/**
 * A selects sequence: each hit as a clip (a second either side), one after
 * another, picture and sound linked. It is opened, and Undo takes it away.
 */
export function selectsSequence(p: Project, hits: Hit[], name: string, pad = 1): { project: Project; seq: string; count: number } {
  const base = current(p);
  const seq = newSequence(name, base.width, base.height, base.fps, 1, 1);
  const fps = seq.fps;
  const v = seq.tracks.find((t) => t.kind === 'video')?.id as string;
  const a = seq.tracks.find((t) => t.kind === 'audio')?.id as string;
  const clips: Clip[] = [];
  let at = 0;
  for (const h of hits) {
    const m = p.media.find((x) => x.id === h.media);
    if (!m) continue;
    const from = Math.max(0, h.from - pad);
    const to = m.duration > 0 ? Math.min(m.duration, h.to + pad) : h.to + pad;
    const length = Math.max(1, Math.round((to - from) * fps));
    const link = m.hasVideo && m.hasAudio ? uid('l') : null;
    const source = { kind: 'media' as const, media: m.id, in: from };
    if (m.hasVideo) clips.push({ ...newClip(v, at, length, source, m.name), link });
    if (m.hasAudio) clips.push({ ...newClip(a, at, length, source, m.name), link });
    at += length;
  }
  const made = { ...seq, clips };
  return { project: { ...p, sequences: [...p.sequences, made], open: made.id }, seq: made.id, count: hits.length };
}

/** The files with hits, put in a new bin named for the search. */
export function hitsToBin(p: Project, hits: Hit[], name: string): { project: Project; bin: string; count: number } {
  const ids = new Set(hits.map((h) => h.media));
  const bin = uid('b');
  return {
    project: { ...p, bins: [...p.bins, { id: bin, name, parent: null }], media: p.media.map((m) => (ids.has(m.id) ? { ...m, bin } : m)) },
    bin,
    count: ids.size,
  };
}
'''
open(p, 'w').write(s)

p = 'search.test.ts'
s = open(p).read()
s = s.replace("import { decodeLooks, encodeLooks, labelMatches, lookTimes, parseQuery, search, shotType, type LookIndex } from './search';",
              "import { decodeLooks, encodeLooks, hitsToBin, labelMatches, lookTimes, parseQuery, search, selectsSequence, shotType, type LookIndex } from './search';")
s += '''
describe('search results into the project', () => {
  it('a selects sequence and a bin', () => {
    const p = { ...emptyProject('t'), media: [media('a', ['hi', 'there']), media('b', ['bye'])] };
    const hits = search(p.media, new Map(), 'hi');
    const made = selectsSequence(p, hits, 'Selects: hi');
    const s = current(made.project);
    expect(s.name).toBe('Selects: hi');
    expect(s.clips.length).toBe(2);
    expect(s.clips[0]?.link).toBe(s.clips[1]?.link);
    expect(s.clips[0]?.source).toEqual({ kind: 'media', media: 'a', in: 0 });
    const binned = hitsToBin(p, hits, 'Search: hi');
    expect(binned.count).toBe(1);
    expect(binned.project.media.find((m) => m.id === 'a')?.bin).toBe(binned.bin);
    expect(binned.project.media.find((m) => m.id === 'b')?.bin).toBeNull();
  });
});
'''
open(p, 'w').write(s)
