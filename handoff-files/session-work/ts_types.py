import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
p='titler/src/core/types.ts'
s=open(p).read()
def rep(a,b):
    global s
    assert a in s, a[:60]
    s=s.replace(a,b)
rep("""  /** A ticker: the line moves left (crawl) or the lines move up (roll), px per second. */""","""  /** The shared text style it is linked to (TitleProject.textStyles). */
  styleRef?: string | null;
  /** A ticker: the line moves left (crawl) or the lines move up (roll), px per second. */""")
rep("""export interface TitleProject {""","""/** A text style shared across the title (layers linked to it follow it). */
export interface TextStyleDef {
  id: string;
  name: string;
  style: TextStyle;
}

export interface TitleProject {""")
rep("""  data?: DataSource[];
  modified?: number;
}""","""  data?: DataSource[];
  /** Shared text styles. */
  textStyles?: TextStyleDef[];
  modified?: number;
}""")
open(p,'w').write(s)

p='titler/src/designer/Inspector.tsx'
s=open(p).read()
rep("""    <Section title="Text">
      <textarea""","""    <Section title="Text">
      <TextStyleRow store={store} l={l} />
      <textarea""")
rep("""const ANIMATOR_PRESETS:""","""/** The shared text style a layer is linked to: choose, make, update, reset, detach. */
function TextStyleRow({ store, l }: { store: Store; l: TextLayer }) {
  const project = useStore(store, (s) => s.project);
  const styles = project.textStyles ?? [];
  const differs = differsFromStyle(project, l);
  const def = styles.find((d) => d.id === l.styleRef);
  return (
    <div className="tt-textstyle">
      <Row label="Text style" hint="Shared text styles: change a style and every text linked to it follows, in every composition.">
        <select
          className="tt-select"
          aria-label="Text style"
          value={def?.id ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '+') {
              const name = prompt('Name of the new text style', l.name);
              if (name !== null) store.edit('New text style', (p) => newTextStyle(p, l.id, name).project);
              return;
            }
            store.edit(v ? 'Apply text style' : 'Detach text style', (p) => applyTextStyle(p, [l.id], v || null));
          }}
        >
          <option value="">None</option>
          {styles.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value="+">New style from this text…</option>
        </select>
      </Row>
      {def && differs && (
        <div className="tt-textstyle-differs" role="status">
          <span className="tt-dim">Changed from “{def.name}”</span>
          <button className="tt-link" onClick={() => store.edit('Update text style', (p) => styleFromLayer(p, l))} title="Every text linked to this style takes this look">
            Update style
          </button>
          <button className="tt-link" onClick={() => store.edit('Reset to text style', (p) => applyTextStyle(p, [l.id], def.id))}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

const ANIMATOR_PRESETS:""")
open(p,'w').write(s)
print('ok')
