import { describe, expect, it } from 'vitest';
import { current } from '../model/seq';
import { emptyProject, type MediaItem } from '../model/types';
import { buildRoughCut, matchScript, scriptLines, token } from './scriptcut';

/** A file whose transcript says these words, one every half second from `at`. */
function file(id: string, said: string, at = 0, video = true): MediaItem {
  const words = said
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({ w, s: at + i * 0.5, e: at + i * 0.5 + 0.4 }));
  return {
    id,
    name: id,
    path: `/${id}.mp4`,
    proxy: null,
    kind: video ? 'video' : 'audio',
    duration: at + words.length * 0.5 + 5,
    width: 1920,
    height: 1080,
    fps: 25,
    hasVideo: video,
    hasAudio: true,
    bin: null,
    transcript: { language: 'en', model: 't', words, done: [[0, 999]] },
  };
}

describe('rough cut from a script', () => {
  it('reads the script line by line', () => {
    expect(scriptLines('Welcome, everyone. Thank you for coming!\n\nLet us begin.')).toEqual(['Welcome, everyone.', 'Thank you for coming!', 'Let us begin.']);
    expect(token('Coming!')).toBe('coming');
  });

  it('finds each line in the takes, best and later first, and says which were never said', () => {
    const take1 = file('Take 1', 'um welcome every one thank you for for coming tonight let us begin', 0);
    const take2 = file('Take 2', 'welcome everyone thank you all for coming let us begin now', 0);
    const m = matchScript(['Welcome everyone.', 'Thank you for coming.', 'Let us begin.', 'The end is near.'], [take1, take2]);
    expect(m.map((x) => x.best?.media ?? null)).toEqual(['Take 2', 'Take 1', 'Take 1', null]);
    // "Thank you for coming" is in both: the other take is kept as an alternate.
    expect(m[1]?.others.map((t) => t.media)).toEqual(['Take 2']);
    // Times are the first and last matched words.
    expect(m[0]?.best).toMatchObject({ from: 0, to: 0.9 });
  });

  it('lays the best takes out in order, with alternates hidden above and a marker for a missing line', () => {
    const a = file('A', 'good evening and welcome', 10);
    const b = file('B', 'good evening and welcome to the show', 50);
    const p0 = { ...emptyProject('t'), media: [a, b] };
    const matches = matchScript(['Good evening and welcome.', 'To the show.', 'Never said.'], [a, b]);
    const out = buildRoughCut(p0, matches, { pad: 0.2, alternates: true, name: 'Script cut' });
    const s = current(out.project);
    expect(out.placed).toBe(2);
    expect(s.name).toBe('Script cut');
    expect(s.fps).toBe(25);
    const v1 = s.tracks.find((t) => t.kind === 'video')!;
    const main = s.clips.filter((c) => c.track === v1.id).sort((x, y) => x.start - y.start);
    expect(main.map((c) => (c.source.kind === 'media' ? [c.source.media, c.start] : null))).toEqual([
      ['B', 0],
      ['B', main[1]!.start],
    ]);
    // The alternate (file A) sits above the first line, hidden, no longer than the take below it.
    const alt = s.tracks.find((t) => t.kind === 'video' && t.name === 'Alt 1')!;
    expect(alt.off).toBe(true);
    const altClip = s.clips.find((c) => c.track === alt.id)!;
    expect(altClip.length).toBeLessThanOrEqual(main[0]!.length);
    expect(s.markers.map((k) => k.name)).toEqual(['Not found: Never said.']);
  });
});
