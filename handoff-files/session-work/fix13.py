import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/designer/Panels.tsx'
rep(p,"""  const [error, setError] = useState('');
  const refresh = () =>
    host
      .listLibrary()""","""  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const refresh = () =>
    host
      .listLibrary()""")
rep(p,"""      <div className="tt-side-head">Your titles ({host.libraryName})</div>""","""      <div className="tt-side-head">
        Your titles ({host.libraryName})
        {mine.length > 0 && (
          <button className="tt-ico" onClick={() => setSharing(true)} title="Share titles as a template pack (one file)" aria-label="Share as a pack">
            <Package size={13} />
          </button>
        )}
      </div>
      {sharing && <PackDialog host={host} env={env} onClose={() => setSharing(false)} onDone={(status) => store.set({ status })} />}""")
s=open(p).read()
import re
m=re.search(r"import \{([^}]*)\} from 'lucide-react';",s)
assert m
names=m.group(1)
s=s.replace(m.group(0),"import {"+names.rstrip().rstrip(',')+", Package } from 'lucide-react';",1)
s=s.replace("import type { Store }","import { PackDialog } from './PackDialog';\nimport type { Store }",1) if "import type { Store }" in s else s
open(p,'w').write(s)
s=open(p).read()
if "from './PackDialog'" not in s:
    s=s.replace("from 'lucide-react';","from 'lucide-react';\nimport { PackDialog } from './PackDialog';",1)
    open(p,'w').write(s)
s=open('titler/src/designer/designer.css').read()
s+='''.tt-pack-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--tt-line);
  border-radius: var(--tt-radius);
}
'''
open('titler/src/designer/designer.css','w').write(s)
