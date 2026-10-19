p='editor/app/src/model/captions.ts'
s=open(p).read()
s=s.replace("""  clip: string;
  media: string;
  index: number;
}""","""  clip: string;
  media: string;
  index: number;
  /** Who says it: the file (one person on each microphone), or `file#voice` when voices were told apart in one file. */
  who: string;
}""",1)
s=s.replace("""          all.push({ w: w.w, from, to, clip: c.id, media: m.id, index });
          return;""","""          all.push({ w: w.w, from, to, clip: c.id, media: m.id, index, who: whoOf(m.id, w.v) });
          return;""")
s=s.replace("""        all.push({ w: w.w, from, to, clip: c.id, media: m.id, index });
      });""","""        all.push({ w: w.w, from, to, clip: c.id, media: m.id, index, who: whoOf(m.id, w.v) });
      });""")
old=s[s.index("/** Who is heard on a file: the name given"):s.index("/** The transcript's paragraphs")]
new='''/** Who says a word: the file, or one of the voices told apart in it. */
export const whoOf = (media: string, voice: number | undefined): string => (voice === undefined ? media : `${media}#${voice}`);
const splitWho = (who: string): [string, number | null] => {
  const i = who.lastIndexOf('#');
  const v = i > 0 ? Number(who.slice(i + 1)) : NaN;
  return Number.isInteger(v) && v >= 0 ? [who.slice(0, i), v] : [who, null];
};

/** Who is heard: the name given in the transcript, otherwise the file's name (or "Speaker 2" for a voice told apart in a file). */
export function speakerName(p: Project, who: string): string {
  const [media, voice] = splitWho(who);
  const m = p.media.find((x) => x.id === media);
  if (voice !== null) return m?.voices?.[voice]?.trim() || `Speaker ${voice + 1}`;
  const named = m?.speaker?.trim();
  if (named) return named;
  return (m?.name ?? 'Speaker').replace(/\\.[^.]+$/, '');
}

/** Give the person heard on a file (or one of its voices) a name (empty: back to the default). */
export function nameSpeaker(p: Project, who: string, name: string): Project {
  const [media, voice] = splitWho(who);
  return {
    ...p,
    media: p.media.map((m) => {
      if (m.id !== media) return m;
      if (voice !== null) {
        const voices = [...(m.voices ?? [])];
        while (voices.length <= voice) voices.push('');
        voices[voice] = name.trim();
        return { ...m, voices };
      }
      const { speaker: _old, ...rest } = m;
      return name.trim() ? { ...rest, speaker: name.trim() } : rest;
    }),
  };
}

'''
s=s.replace(old,new)
s=s.replace("""    if (!prev || w.from - prev.to > pause || prev.media !== w.media) out.push([i]);""","""    if (!prev || w.from - prev.to > pause || prev.who !== w.who) out.push([i]);""")
open(p,'w').write(s)
