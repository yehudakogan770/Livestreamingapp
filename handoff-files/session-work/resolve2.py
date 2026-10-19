import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ae2e4fb2496ef2830')
p = 'planner/src/PlanList.tsx'
s = open(p).read()
a = s.index('<<<<<<< HEAD\n')
b = s.index('>>>>>>> claude/festive-curie-637ic2\n') + len('>>>>>>> claude/festive-curie-637ic2\n')
s = s[:a] + """        {canPlan && (
          <form className="row page__new" onSubmit={make}>
            <input
              className="input grow"
              placeholder="New event name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              aria-label="New event name"
            />
            <button type="submit" className="btn btn--primary" disabled={busy}>
              New plan
            </button>
          </form>
        )}
""" + s[b:]
open(p, 'w').write(s)
