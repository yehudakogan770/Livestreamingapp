import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/designer/Panels.tsx'
rep(p,"""            {c.id !== main.id && (
              <button
                className="tt-link"
                title="Make it again from the main composition (changes made in this format are lost)"
                onClick={() => {
                  if (!confirm(`Make “${c.name}” again from the main composition? Changes made in it are lost.`)) return;
                  store.edit('Remake format', (p) => makeFormat(p, '', c.width, c.height, c.id).project);
                }}
              >
                Remake
              </button>
            )}""","""            {c.id !== main.id && (
              <>
                <label className="tt-check" title="Changes to the main composition come here too (what you change in this format stays)">
                  <input
                    type="checkbox"
                    checked={c.follow !== false}
                    aria-label={`${c.name} follows the main composition`}
                    onChange={(e) =>
                      store.edit(e.target.checked ? 'Format follows the main one' : 'Format on its own', (p) => ({
                        ...p,
                        compositions: p.compositions.map((x) => (x.id === c.id ? { ...x, follow: e.target.checked } : x)),
                      }))
                    }
                  />
                  Follows
                </label>
                <button
                  className="tt-link"
                  title="Make it again from the main composition (changes made in this format are lost)"
                  onClick={() => {
                    if (!confirm(`Make “${c.name}” again from the main composition? Changes made in it are lost.`)) return;
                    store.edit('Reset format', (p) => {
                      const r = makeFormat(p, '', c.width, c.height, c.id).project;
                      return { ...r, compositions: r.compositions.map((x) => (x.id === c.id ? { ...x, follow: c.follow } : x)) };
                    });
                  }}
                >
                  Reset
                </button>
              </>
            )}""")
rep(p,"""          This format was made from the main composition; change it here as you like. Its layers keep their names, fields and timing.""","""          {current.follow === false
            ? 'This format stands on its own: changes to the main composition do not come here.'
            : 'Changes to the main composition come here too, placed by each layer’s constraints. What you change in this format stays as you set it.'}""")
