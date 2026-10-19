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

edit('views/OverlayBar.tsx',[
('''      <span className="ovbar__label">Overlays</span>''','''      <span className="ovbar__label">
        <Layers aria-hidden="true" />
        Overlays
      </span>'''),
('''              <b>{ch + 1}</b>
              {src && <span>{src.name}</span>}''','''              <b>{ch + 1}</b>
              {src ? <span>{src.name}</span> : <Plus className="ovbar__plus" aria-hidden="true" />}'''),
('''aria-label={`Edit overlay ${ch + 1}`} onClick={() => setEditing(ch)}>
                ✎
              </button>''','''aria-label={`Edit overlay ${ch + 1}`} title="Edit" onClick={() => setEditing(ch)}>
                <Pencil aria-hidden="true" />
              </button>'''),
], "import { Layers, Pencil, Plus } from 'lucide-react';")

edit('views/OverlayBar.css',[
('''.ovbar__label {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-dim);
  text-transform: none;
  padding-right: 3px;
}''','''.ovbar__label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  text-transform: uppercase;
  padding-right: 4px;
}
.ovbar__label svg.lucide {
  width: 12px;
  height: 12px;
}
.ovbar__plus {
  width: 11px !important;
  height: 11px !important;
}'''),
('''.ovbar__btn {
  min-width: 26px;
  height: 22px;''','''.ovbar__btn {
  min-width: 26px;
  height: 24px;'''),
('''.ovbar .ovbar__btn.is-on {
  background: var(--program);
  border-color: var(--program-bright);
}''','''.ovbar .ovbar__btn.is-on {
  background: linear-gradient(#e8392f, #bf2820);
  border-color: #7d1712;
  border-top-color: #ff8a80;
}'''),
('''.ovbar .ovbar__btn.is-next {
  border-color: var(--preview-bright);
}
.ovbar__edit {
  width: 20px;
  height: 22px;
  border: 1px solid var(--border-strong);
  border-left: 0;
  border-radius: 0 var(--radius) var(--radius) 0;
  background: var(--button);
  font-size: 11px;
}''','''.ovbar .ovbar__btn.is-next {
  border-color: var(--preview-bright);
  box-shadow: inset 0 -2px 0 var(--preview-bright);
}
.ovbar__edit {
  min-width: 22px;
  width: 22px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-left: 0;
  border-radius: 0 var(--radius) var(--radius) 0;
  background: var(--button);
}
.ovbar__edit svg.lucide {
  width: 11px;
  height: 11px;
}'''),
])

edit('views/ControlView.css',[
('''.linkbtn {
  border: 0;''','''.icon small {
  font-family: var(--mono);
  font-size: 10px;
}
.linkbtn {
  border: 0;'''),
])
