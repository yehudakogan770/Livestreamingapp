def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/app/src/ui/Inspector.tsx', [
("""              `text-${main.id}`,
            )
          }
        />
      )}""","""              `text-${main.id}`,
            )
          }
        />
      )}
      {main.source.kind === 'text' && (
        <Section title="Title design">
          <TitleExtras
            clip={main}
            fps={fps}
            onChange={(text, final) =>
              upd(main, 'Text', (c) => (c.source.kind === 'text' ? { ...c, source: { ...c.source, text } } : c), final, `text-${main.id}`)
            }
          />
        </Section>
      )}"""),
("""import { TEXT_PRESETS } from '../render/text';""","""import { TEXT_PRESETS } from '../render/text';
import { TitleExtras } from './Templates';"""),
])

edit('editor/app/src/ui/ProjectPanel.tsx', [
("""function TextTab({ actions }: { actions: Actions }) {
  const [color, setColor] = useState('#1e3a5f');
  return (
    <div className="fxlist">
      <p className="fxlist__hint">Added at the playhead, on the first free track above the pictures.</p>""","""function TextTab({ actions }: { actions: Actions }) {
  const [color, setColor] = useState('#1e3a5f');
  return (
    <div className="fxlist">
      <p className="fxlist__hint">Added at the playhead, on the first free track above the pictures.</p>
      <TemplatesSection actions={actions} />"""),
("""import { TEXT_PRESETS } from '../render/text';""","""import { TEXT_PRESETS } from '../render/text';
import { TemplatesSection } from './Templates';"""),
])
print('ok')
