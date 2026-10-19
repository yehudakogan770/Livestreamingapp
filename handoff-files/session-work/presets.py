root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
def edit(path, pairs, imp=None):
    p=root+path
    s=open(p).read()
    for old,new in pairs:
        assert old in s, (path, old[:80])
        s=s.replace(old,new,1)
    if imp:
        i=s.index('import ')
        s=s[:i]+imp+'\n'+s[i:]
    open(p,'w').write(s)

edit('views/PresetsPanel.tsx',[
('''      <div className="presets__head">
        <span className="presets__title">Presets</span>
        <button type="button" className="chip" onClick={() => setEditing('new')}>
          + Add
        </button>
      </div>''','''      <div className="phead presets__head">
        <ListOrdered aria-hidden="true" />
        <span className="presets__title">Presets</span>
        <span className="phead__actions">
          <button type="button" className="btn" title="Add a preset" onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            Add
          </button>
        </span>
      </div>'''),
('''        {show.presets.length === 0 && (
          <li
            className="presets__empty"
            title="A preset is a part of the event (Opening, Speaker, Video…): its inputs, transition and buttons. Add one to run the show in order."
          >
            No presets yet.
          </li>
        )}''','''        {show.presets.length === 0 && (
          <li
            className="presets__empty"
            title="A preset is a part of the event (Opening, Speaker, Video…): its inputs, transition and buttons. Add one to run the show in order."
          >
            <ListOrdered aria-hidden="true" />
            <span>No presets yet.</span>
            <small>A preset is a part of the event: its inputs, transition and buttons.</small>
          </li>
        )}'''),
('''              <button type="button" className="presets__edit" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                ✎
              </button>''','''              <button type="button" className="presets__edit" aria-label={`Edit ${p.name}`} title="Edit" onClick={() => setEditing(p)}>
                <Pencil aria-hidden="true" />
              </button>'''),
('''            ◀ Prev
          </button>''','''            <ChevronLeft aria-hidden="true" />
            Prev
          </button>'''),
('''            Next ▶
          </button>''','''            Next
            <ChevronRight aria-hidden="true" />
          </button>'''),
], "import { ChevronLeft, ChevronRight, ListOrdered, Pencil, Plus } from 'lucide-react';")

t=root+'App.test.tsx'
s=open(t).read()
s=s.replace("screen.getByRole('button', { name: '+ Add' })","within(screen.getByLabelText('Presets')).getByRole('button', { name: 'Add' })")
open(t,'w').write(s)

edit('views/ControlView.css',[
('''.presets {
  width: 200px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0 8px 10px;
  min-height: 0;
}
.presets__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 22px;
}
.presets__title {
  font-size: 13px;
  font-weight: 600;
}
.presets__search {
  height: 28px;
}''','''/* The presets column: a full-height side panel. */
.presets {
  width: 208px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  min-height: 0;
  background: var(--bar);
  border-right: 1px solid #000;
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.03);
}
.presets__title {
  font-size: 13px;
  font-weight: 600;
}
.presets__search {
  height: 28px;
  margin: 8px 8px 0;
}
.presets__list {
  padding: 6px !important;
}
.presets__nav {
  padding: 8px;
  border-top: 1px solid var(--border);
}'''),
('''.presets__empty {
  padding: 10px 6px;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.5;
}''','''.presets__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 8px 4px;
  padding: 18px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
  text-align: center;
}
.presets__empty svg.lucide {
  width: 20px;
  height: 20px;
  stroke-width: 1.5;
  color: var(--text-faint);
}
.presets__empty small {
  color: var(--text-faint);
  font-size: 11px;
}'''),
('''.presets__item.is-on .presets__pick {
  border-color: var(--accent);
  background: var(--selected);
}''','''.presets__item.is-on .presets__pick {
  border-color: var(--accent);
  background: var(--selected);
  box-shadow: inset 3px 0 0 var(--accent);
}'''),
('''.presets__edit {
  position: absolute;
  right: 3px;
  top: 5px;
  width: 22px;
  height: 22px;
  padding: 0;''','''.presets__edit {
  position: absolute;
  right: 3px;
  top: 5px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;'''),
])
