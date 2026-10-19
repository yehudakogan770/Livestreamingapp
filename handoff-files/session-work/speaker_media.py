import sys
root = sys.argv[1]


def edit(path, pairs):
    p = root + '/' + path
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (path, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)


edit('editor/app/src/model/types.ts', [
    ("""  /** Who is heard on each sound file (by media id), as shown in the transcript. */
  speakers?: Record<string, string>;
""", ""),
    ("""  /** A subclip: only this part of the file (seconds), e.g. one shot found by scene detection. */""",
     """  /** Who is heard in it, as named in the transcript (shared with everyone on a shared project). */
  speaker?: string;
  /** A subclip: only this part of the file (seconds), e.g. one shot found by scene detection. */"""),
])

edit('editor/app/src/model/captions.ts', [
    ("""export function speakerName(p: Project, media: string): string {
  const named = p.speakers?.[media]?.trim();
  if (named) return named;
  return (p.media.find((m) => m.id === media)?.name ?? 'Speaker').replace(/\\.[^.]+$/, '');
}""", """export function speakerName(p: Project, media: string): string {
  const m = p.media.find((x) => x.id === media);
  const named = m?.speaker?.trim();
  if (named) return named;
  return (m?.name ?? 'Speaker').replace(/\\.[^.]+$/, '');
}"""),
    ("""export function nameSpeaker(p: Project, media: string, name: string): Project {
  const speakers = { ...(p.speakers ?? {}) };
  if (name.trim()) speakers[media] = name.trim();
  else delete speakers[media];
  return { ...p, speakers };
}""", """export function nameSpeaker(p: Project, media: string, name: string): Project {
  return {
    ...p,
    media: p.media.map((m) => {
      if (m.id !== media) return m;
      const { speaker: _old, ...rest } = m;
      return name.trim() ? { ...rest, speaker: name.trim() } : rest;
    }),
  };
}"""),
])

edit('editor/app/src/ui/transcript.test.tsx', [
    ("""    expect(doc.project.speakers).toEqual({ Guest: 'Dr. Levin' });""", """    expect(doc.project.media.find((m) => m.id === 'Guest')?.speaker).toBe('Dr. Levin');"""),
])
