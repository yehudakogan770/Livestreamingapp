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

p=root+'views/AddInput.tsx'
s=open(p).read()
i=s.index('                  <strong>{k.name}</strong>')
s=s[:i]+'                  <KindIcon kind={k.kind} />\n'+s[i:]
s=s.replace('''/** Choose what kind of input to add, set it up, and add it. */''','''function KindIcon({ kind }: { kind: string }) {
  const I = kindIcon(kind);
  return <I className="addinput__icon" aria-hidden="true" />;
}

/** Choose what kind of input to add, set it up, and add it. */''',1)
open(p,'w').write(s)

edit('views/ControlView.css',[
('''.addinput__kinds {
  /* Every kind at once, grouped by what it is for, in three columns (the description shows on the right). */
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  gap: 2px;
  padding: 4px 10px 10px;
  border-right: 1px solid var(--border);
}
.addinput__group {
  grid-column: 1 / -1;
  margin: 10px 0 2px;
  padding-bottom: 3px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
}
.addinput__group--best {
  color: var(--text);
}''','''.addinput__kinds {
  /* Every kind at once, grouped by what it is for, in three columns (the description shows on the right). */
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  gap: 2px;
  padding: 4px 10px 10px;
  border-right: 1px solid #000;
  background: var(--bar);
}
.addinput__group {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 12px 0 4px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--border);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.addinput__group svg.lucide {
  width: 13px;
  height: 13px;
  color: var(--text-faint);
}
.addinput__group--best {
  color: var(--accent);
}
.addinput__group--best svg.lucide {
  color: var(--accent);
}'''),
('''.addinput__kind {
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  background: transparent;
  text-align: left;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.addinput__kind:hover {
  background: var(--button);
}''','''.addinput__kind {
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  font-size: 12.5px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  background: transparent;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 8px;
}
.addinput__icon {
  color: var(--text-faint);
}
.addinput__kind:hover {
  background: var(--button);
}
.addinput__kind:hover .addinput__icon,
.addinput__kind[aria-pressed='true'] .addinput__icon {
  color: var(--accent);
}'''),
('''.addinput__kind[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--selected);
}''','''.addinput__kind[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--selected);
  box-shadow: inset 3px 0 0 var(--accent);
}'''),
])
