root='/home/user/Livestreamingapp/.claude/worktrees/agent-aa20d25c9832f0a41/editor/app/src/'
def rep(path,a,b):
    s=open(root+path).read()
    assert s.count(a)==1,(path,a[:70],s.count(a))
    s=s.replace(a,b)
    open(root+path,'w').write(s)

rep('ui/actions.ts',"""    addShape: (kind: ShapeData['kind']) => {""","""    /** A Lumora Titler graphic at the playhead (as long as the title). */
    addTitler: (title: TitleProject) => {
      let id = '';
      edit(`Add ${title.name}`, (p) => {
        const r = addTitlerClip(p, here(), fps(), title);
        id = r.id;
        return r.project;
      });
      if (id) doc.select({ kind: 'clips', ids: [id] });
    },
    /** A title clip takes a new design from the Titler (its fields' values stay). */
    useTitler: (title: TitleProject, clipId: string) =>
      edit('Change title design', (p) => ({
        ...p,
        sequences: p.sequences.map((s) => ({
          ...s,
          clips: s.clips.map((c) => (c.id === clipId && c.source.kind === 'titler' ? { ...c, name: title.name, source: { ...c.source, project: title } } : c)),
        })),
      })),
    /** A clip by id in the open sequence. */
    clipById: (id: string) => seq().clips.find((c) => c.id === id),
    addShape: (kind: ShapeData['kind']) => {""")
s=open(root+'ui/actions.ts').read()
s=s.replace("import { addShape } from '../model/shapes';","import { addShape } from '../model/shapes';\nimport { addTitlerClip } from '../titler/titlerClip';\nimport type { TitleProject } from '../../../../titler/src/core/types';",1)
open(root+'ui/actions.ts','w').write(s)

rep('ui/Editor.tsx',"""        <Timeline doc={doc} engine={engine} ui={ui} actions={actions} collab={collab} />
      </div>""","""        <Timeline doc={doc} engine={engine} ui={ui} actions={actions} collab={collab} />
      </div>
      <StudioTitlerHost clipOf={actions.clipById} onUse={(t, id) => (id ? actions.useTitler(t, id) : actions.addTitler(t))} />""")
s=open(root+'ui/Editor.tsx').read()
i=s.index('\nimport ')
s=s[:i]+"\nimport { StudioTitlerHost } from '../titler/StudioTitler';"+s[i:]
open(root+'ui/Editor.tsx','w').write(s)

rep('ui/ProjectPanel.tsx',"""      <TemplatesSection actions={actions} />""","""      <TemplatesSection actions={actions} />
      <TitlerSection onAdd={actions.addTitler} />""")
s=open(root+'ui/ProjectPanel.tsx').read()
i=s.index('\nimport ')
s=s[:i]+"\nimport { TitlerSection } from '../titler/StudioTitler';"+s[i:]
open(root+'ui/ProjectPanel.tsx','w').write(s)

rep('ui/Inspector.tsx',"""      {main.source.kind === 'generator' && <GeneratorEditor clip={main} upd={upd} />}""","""      {main.source.kind === 'generator' && <GeneratorEditor clip={main} upd={upd} />}
      {main.source.kind === 'titler' && <TitlerClipEditor clip={main} fps={rate(current(project))} upd={upd} />}""")
s=open(root+'ui/Inspector.tsx').read()
i=s.index('\nimport ')
s=s[:i]+"\nimport { TitlerClipEditor } from '../titler/StudioTitler';"+s[i:]
open(root+'ui/Inspector.tsx','w').write(s)

rep('ui/Timeline.tsx',"""  if (src.kind === 'shape') return '#4a7a9a';""","""  if (src.kind === 'shape') return '#4a7a9a';
  if (src.kind === 'titler') return '#5f5491';""")
