def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/app/src/ui/actions.ts', [
("""import { TEXT_PRESETS } from '../render/text';""","""import { TEXT_PRESETS } from '../render/text';
import { addTemplate, templateById } from '../model/templates';"""),
("""    addGenerated: (kind: 'color' | 'adjustment', color?: string) => {""","""    /** A title template at a frame (the playhead), on a track (or the first free one above the pictures). */
    addTemplate: (id: string, at?: number, track?: string) => {
      const t = templateById(id);
      if (!t) return;
      let made = '';
      edit(`Add ${t.name}`, (p) => {
        const r = addTemplate(p, t, at ?? here(), fps(), track);
        made = r.id;
        return r.project;
      });
      if (made) doc.select({ kind: 'clips', ids: [made] });
    },
    addGenerated: (kind: 'color' | 'adjustment', color?: string) => {"""),
])

edit('editor/app/src/ui/Timeline.tsx', [
("""      !types.includes('application/x-lumora-effect') &&
      !types.includes('application/x-lumora-transition')
    )
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (types.includes('application/x-lumora-media') || types.includes('application/x-lumora-seq')) {""","""      !types.includes('application/x-lumora-effect') &&
      !types.includes('application/x-lumora-transition') &&
      !types.includes('application/x-lumora-template')
    )
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (types.includes('application/x-lumora-media') || types.includes('application/x-lumora-seq') || types.includes('application/x-lumora-template')) {"""),
("""    const mediaId = e.dataTransfer.getData('application/x-lumora-media');
    const seqId = e.dataTransfer.getData('application/x-lumora-seq');""","""    const mediaId = e.dataTransfer.getData('application/x-lumora-media');
    const seqId = e.dataTransfer.getData('application/x-lumora-seq');
    const template = e.dataTransfer.getData('application/x-lumora-template');
    if (template) {
      e.preventDefault();
      let f = toFrame(p.x);
      if (u.snapping) f = nearest(pointsFor(new Set()), f, snapWithin) ?? f;
      const t = row?.track;
      actions.addTemplate(template, f, t?.kind === 'video' && !t.captions ? t.id : undefined);
      return;
    }"""),
])
print('ok')
