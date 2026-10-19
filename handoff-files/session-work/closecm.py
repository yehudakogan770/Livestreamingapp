import re, glob
root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'

def add_import(s, names):
    m = re.search(r"import \{([^}]*)\} from 'lucide-react';", s)
    if m:
        have = [x.strip() for x in m.group(1).split(',') if x.strip()]
        allx = sorted(set(have) | set(names), key=lambda x: (x.startswith('type '), x.lower()))
        return s[:m.start()] + "import { " + ', '.join(allx) + " } from 'lucide-react';" + s[m.end():]
    i = s.index('import ')
    return s[:i] + "import { " + ', '.join(sorted(names)) + " } from 'lucide-react';\n" + s[i:]

changed=[]
for f in glob.glob(root+'**/*.tsx', recursive=True):
    s=open(f).read()
    lines=s.split('\n')
    n=0
    for i,l in enumerate(lines):
        if l.strip()=='✕':
            # the button opening tag must be within the 3 lines before
            ctx='\n'.join(lines[max(0,i-9):i])
            if '<button' in ctx:
                lines[i]=l.replace('✕','<X aria-hidden="true" />')
                n+=1
    if n:
        s='\n'.join(lines)
        s=add_import(s,['X'])
        open(f,'w').write(s)
        changed.append((f.replace(root,''),n))
print(changed)
