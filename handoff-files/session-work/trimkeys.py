import sys
root = sys.argv[1]


def edit(path, pairs):
    p = root + '/' + path
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (path, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)


edit('editor/app/src/model/edit.ts', [
    ("""/** Trim the edit nearest a frame to it, closing up (Q: the start side; W: the end side). */""",
     """/** The cut on a track nearest a frame: where it is, the clip ending there and the clip starting there (either may be missing). */
export function cutNear(s: Sequence, frame: number, track: string): { at: number; left: Clip | null; right: Clip | null } | null {
  const clips = s.clips.filter((c) => c.track === track);
  let best: number | null = null;
  for (const c of clips)
    for (const e of [c.start, end(c)]) if (best === null || Math.abs(e - frame) < Math.abs(best - frame) || (Math.abs(e - frame) === Math.abs(best - frame) && e > best)) best = e;
  if (best === null) return null;
  const at = best;
  return { at, left: clips.find((c) => end(c) === at) ?? null, right: clips.find((c) => c.start === at) ?? null };
}

/** Move the cut nearest a frame by some frames: rolling (the clips either side change) or rippling (the film after moves). */
export function trimCut(p: Project, frame: number, track: string, delta: number, mode: 'roll' | 'ripple'): Project {
  const cut = cutNear(current(p), frame, track);
  if (!cut) return p;
  if (cut.left) return trim(p, cut.left.id, 'end', delta, mode);
  if (cut.right) return trim(p, cut.right.id, 'start', delta, mode === 'roll' ? 'normal' : mode);
  return p;
}

/** Extend edit: the cut nearest the playhead rolls to it. */
export function extendEdit(p: Project, frame: number, track: string): Project {
  const cut = cutNear(current(p), frame, track);
  if (!cut || cut.at === frame) return p;
  if (cut.left) return trim(p, cut.left.id, 'end', frame - cut.at, 'roll');
  if (cut.right) return trim(p, cut.right.id, 'start', frame - cut.at, 'normal');
  return p;
}

/** Trim the edit nearest a frame to it, closing up (Q: the start side; W: the end side). */"""),
])

edit('editor/app/src/ui/actions.ts', [
    ("""    nudge: (frames: number) => {""", """    /** The track keyboard trims work on: the selected clip's, or the target picture track. */
    extendEdit: () => {
      const t = trimTrack();
      if (t) edit('Extend edit', (p) => extendEdit(p, here(), t));
    },
    trimCut: (frames: number, mode: 'roll' | 'ripple') => {
      const t = trimTrack();
      if (t) edit(mode === 'roll' ? 'Roll the cut' : 'Ripple the cut', (p) => trimCut(p, here(), t, frames, mode), `trimcut-${mode}`);
    },
    nudge: (frames: number) => {"""),
    ("""  const edit = (label: string, f: (p: Project) => Project, key?: string) => doc.edit(f, label, key);""",
     """  const edit = (label: string, f: (p: Project) => Project, key?: string) => doc.edit(f, label, key);
  const trimTrack = (): string | null => {
    const s = seq();
    const sel = selected()
      .map((id) => s.clips.find((c) => c.id === id))
      .find((c) => c && !s.tracks.find((t) => t.id === c.track)?.locked);
    return sel?.track ?? targets().v;
  };"""),
    ("""  closeGap,""", """  closeGap,
  extendEdit,
  trimCut,"""),
])

edit('editor/app/src/ui/shortcuts.ts', [
    ("""  { id: 'nudgeLeft', label: 'Nudge the selection a frame left', group: 'Timeline', run: (a) => a.nudge(-1) },""",
     """  { id: 'extendEdit', label: 'Extend edit (roll the nearest cut to the playhead)', group: 'Timeline', run: (a) => a.extendEdit() },
  { id: 'rollCutLeft', label: 'Roll the nearest cut a frame left', group: 'Timeline', run: (a) => a.trimCut(-1, 'roll') },
  { id: 'rollCutRight', label: 'Roll the nearest cut a frame right', group: 'Timeline', run: (a) => a.trimCut(1, 'roll') },
  { id: 'rippleCutLeft', label: 'Ripple the nearest cut a frame left', group: 'Timeline', run: (a) => a.trimCut(-1, 'ripple') },
  { id: 'rippleCutRight', label: 'Ripple the nearest cut a frame right', group: 'Timeline', run: (a) => a.trimCut(1, 'ripple') },
  { id: 'nudgeLeft', label: 'Nudge the selection a frame left', group: 'Timeline', run: (a) => a.nudge(-1) },"""),
    ("""  nudgeLeft: ['Alt+Left'],
  nudgeRight: ['Alt+Right'],
  videoTransition: ['Ctrl+D'],""", """  nudgeLeft: ['Alt+Left'],
  nudgeRight: ['Alt+Right'],
  extendEdit: ['E'],
  rollCutLeft: ['Alt+['],
  rollCutRight: ['Alt+]'],
  rippleCutLeft: ['Ctrl+['],
  rippleCutRight: ['Ctrl+]'],
  videoTransition: ['Ctrl+D'],"""),
])
