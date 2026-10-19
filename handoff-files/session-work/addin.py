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

edit('views/AddInput.tsx',[
('''    { name: forScreen.title, best: true, items: pick(forScreen.best) },
    ...forScreen.order.map((g) => ({ name: GROUPS[g]!.name, best: false, items: pick(GROUPS[g]!.kinds.filter((x) => !forScreen.best.includes(x))) })),''','''    { name: forScreen.title, best: true, icon: Star, items: pick(forScreen.best) },
    ...forScreen.order.map((g) => ({
      name: GROUPS[g]!.name,
      best: false,
      icon: GROUP_ICON[g]!,
      items: pick(GROUPS[g]!.kinds.filter((x) => !forScreen.best.includes(x))),
    })),'''),
('''              <h3 key={sec.name} className={`addinput__group${sec.best ? ' addinput__group--best' : ''}`}>
                {sec.name}
              </h3>,''','''              <h3 key={sec.name} className={`addinput__group${sec.best ? ' addinput__group--best' : ''}`}>
                <sec.icon aria-hidden="true" />
                {sec.name}
              </h3>,'''),
], "import { Star } from 'lucide-react';\nimport { GROUP_ICON, kindIcon } from './kindIcons';")
