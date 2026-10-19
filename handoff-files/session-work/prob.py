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

edit('problems/ProblemsUI.tsx',[
('''        {state === 'ok' ? '✓ All good' : `⚠ ${problems.length} problem${problems.length === 1 ? '' : 's'}`}
      </button>
      {open && (
        <div className="plist" role="dialog" aria-label="Problems">
          {problems.length === 0 ? <p className="plist__none">Everything is working.</p> : problems.map((p) => <ProblemItem key={p.key} p={p} />)}
        </div>
      )}''','''        {state === 'ok' ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
        {state === 'ok' ? 'All good' : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}
      </button>
      {open && (
        <div className="plist" role="dialog" aria-label="Problems">
          <div className="plist__head">
            <ShieldCheck aria-hidden="true" />
            <span>Problem center</span>
            <span className="plist__count">{problems.length}</span>
            <button type="button" className="icon" aria-label="Close" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </div>
          {problems.length === 0 ? (
            <p className="plist__none">
              <CircleCheck aria-hidden="true" />
              Everything is working.
            </p>
          ) : (
            problems.map((p) => <ProblemItem key={p.key} p={p} />)
          )}
        </div>
      )}'''),
('''      <div className="pitem__title">
        {p.title}
        <small>''','''      <div className="pitem__title">
        {p.level === 'error' ? <OctagonAlert aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
        <span className="pitem__text">{p.title}</span>
        <small>'''),
('''      {p.fix && <div className="pitem__fix">What to do: {p.fix}</div>}''','''      {p.fix && (
        <div className="pitem__fix">
          <Wrench aria-hidden="true" />
          <span>What to do: {p.fix}</span>
        </div>
      )}'''),
('''          <strong>
            {p.level === 'error' ? '⚠ ' : ''}
            {p.title}
          </strong>''','''          <strong>
            {p.level === 'error' ? <OctagonAlert aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
            {p.title}
          </strong>'''),
], "import { CircleCheck, OctagonAlert, ShieldCheck, TriangleAlert, Wrench, X } from 'lucide-react';")

t=root+'App.test.tsx'
s=open(t).read()
s=s.replace("getByRole('button', { name: '✓ All good' })","getByRole('button', { name: 'All good' })")
open(t,'w').write(s)
