import os, re
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Inspector.tsx'; s=open(p).read()
a=s.index('        <Row label="Track matte" hint="Seen only through another layer">')
b=s.index('      </Section>\n\n      {l.type === \'null\' && l.camera ? (')
block=s[a:b]
inner='\n'.join(('  '+line if line else line) for line in block.rstrip('\n').split('\n'))
s=s[:a]+"        {l.type !== 'null' && (\n          <>\n"+inner+"\n          </>\n        )}\n"+s[b:]
open(p,'w').write(s)

p='MenuButton.tsx'; s=open(p).read()
s=s.replace('''export function MenuItem({ onClick, children, hint, chosen }: { onClick: () => void; children: ReactNode; hint?: string; chosen?: boolean }) {
  return (
    <button role={chosen === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={chosen} className="tt-menu-item" onClick={onClick}>''','''export function MenuItem({
  onClick,
  children,
  hint,
  chosen,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  chosen?: boolean;
  disabled?: boolean;
}) {
  return (
    <button role={chosen === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={chosen} className="tt-menu-item" onClick={onClick} disabled={disabled}>''')
open(p,'w').write(s)

p='Designer.tsx'; s=open(p).read()
for name, cond in [("cmd.duplicate()", "!selection.length"), ("cmd.group()", "!selection.length"), ("cmd.ungroup()", "store.selected()[0]?.type !== 'group'"), ("cmd.precompose()", "!selection.length"), ("cmd.restack('front')", "!selection.length"), ("cmd.restack('back')", "!selection.length"), ("cmd.remove()", "!selection.length && !store.get().keys.length")]:
    a = "<MenuItem onClick={go(() => %s)} hint=" % name
    assert s.count(a)==1, name
    s=s.replace(a, "<MenuItem disabled={%s} onClick={go(() => %s)} hint=" % (cond, name))
open(p,'w').write(s)

p='designer.css'; s=open(p).read()
s=s.replace('''.tt-menu-hint {
  font: 10.5px var(--tt-mono);
  color: var(--tt-faint);
}''','''.tt-menu-hint {
  margin-left: 18px;
  font: 10.5px var(--tt-mono);
  color: var(--tt-faint);
}
.tt-menu-item:disabled {
  opacity: 0.4;
}''')
open(p,'w').write(s)
