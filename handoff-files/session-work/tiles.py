p='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/views/InputGrid.tsx'
s=open(p).read()
def rep(old,new,count=1):
    global s
    assert old in s, old[:80]
    s=s.replace(old,new,count)
first_import=s.index('import ')
s=s[:first_import]+"import { Ellipsis, Music, Pause, Play, Plus, TriangleAlert, X } from 'lucide-react';\n"+s[first_import:]
rep('''                  <span className="tile__sound">♪</span>''','''                  <span className="tile__sound">
                    <Music aria-hidden="true" />
                  </span>''')
rep('''              <span className="tile__num">{i + 1}</span>
              {problemIds.has(src.id) && (
                <span className="tile__warn" title="Something is wrong with this input: see the problem light">
                  ⚠
                </span>
              )}''','''              {problemIds.has(src.id) && (
                <span className="tile__warn" title="Something is wrong with this input: see the problem light">
                  <TriangleAlert aria-label="Problem" />
                </span>
              )}''')
rep('''              <span className="tile__name">{src.name}</span>
              <span className="tile__kind">''','''              <span className="tile__foot">
                <span className="tile__num">{i + 1}</span>
                <span className="tile__name">{src.name}</span>
              </span>
              <span className="tile__kind">''')
rep('''                {playing ? '❚❚' : '▶'}''','''                {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}''')
rep('''              {removing === src.id ? 'Remove?' : '✕'}''','''              {removing === src.id ? 'Remove?' : <X aria-hidden="true" />}''')
rep('''            <button type="button" className="tile__more" aria-label={`Options for ${src.name}`} onClick={() => setMenu(menu === src.id ? null : src.id)}>
              ⋯
            </button>''','''            <button
              type="button"
              className="tile__more"
              aria-label={`Options for ${src.name}`}
              title="Options"
              onClick={() => setMenu(menu === src.id ? null : src.id)}
            >
              <Ellipsis aria-hidden="true" />
            </button>''')
rep('''        <span className="tile--add__plus">+</span>''','''        <span className="tile--add__plus">
          <Plus aria-hidden="true" />
        </span>''')
open(p,'w').write(s)
