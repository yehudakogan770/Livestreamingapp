W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('app/src/testevent/runner.ts', [
("""                tally: null,
                width: p.width,
                height: p.height,
              });
          }
""","""                tally: null,
                width: p.width,
                height: p.height,
              });
          }
        // And for its multiview (its tally comes from the show itself).
        if (unifiedOn() && !answers.some((a) => a.output === 'multiview')) {
          const s = (await refreshEngineInfo().catch(() => null))?.stats;
          if (s?.outputs.includes('multiview'))
            answers.push({ id: 0, output: 'multiview', fps: s.fps, inSync: null, black: null, overlays: null, tally: true, width: 1920, height: 1080 });
        }
"""),
])
edit('app/src/engine/multiviewLabels.test.ts', [
("""  for (const [id, name] of [
    ['a', 'Stage'],
    ['b', 'Wide'],
  ])""","""  for (const [id, name] of [
    ['a', 'Stage'],
    ['b', 'Wide'],
  ] as const)"""),
])
