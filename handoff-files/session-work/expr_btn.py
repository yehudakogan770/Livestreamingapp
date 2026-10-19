import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
p = 'titler/src/designer/Inspector.tsx'
s = open(p).read()
a = """          className={`tt-ico stopwatch${anim ? ' on' : ''}`}
          onClick={() =>
            store.edit(anim ? 'Remove keyframes' : 'Add keyframes', (pr) =>
              updateLayers(pr, compId, [layer.id], (x) => withProp(x, path, toggleKeys(getProp(x, path) as never, time, fallback as never))),
            )
          }
          title={anim ? 'Animated: click to stop animating' : 'Animate this (a keyframe at the playhead)'}"""
b = """          className={`tt-ico stopwatch${anim ? ' on' : ''}`}
          onClick={(e) => {
            // Alt+click (as in After Effects): an expression instead.
            if (e.altKey) return setExprOpen(true);
            store.edit(anim ? 'Remove keyframes' : 'Add keyframes', (pr) =>
              updateLayers(pr, compId, [layer.id], (x) => withProp(x, path, toggleKeys(getProp(x, path) as never, time, fallback as never))),
            );
          }}
          title={`${anim ? 'Animated: click to stop animating' : 'Animate this (a keyframe at the playhead)'}. Alt+click: an expression (wiggle, loop, time, a link).`}"""
assert a in s
s = s.replace(a, b)
a2 = """        <button
          className={`tt-ico tt-expr-btn${expr ? ' on' : ''}`}
          onClick={() => setExprOpen(!exprOpen && !expr ? true : !exprOpen)}
          title={expr ? `Expression: ${expr}` : 'Add an expression (wiggle, loop, time, a link to another layer)'}
          aria-label={`Expression for ${label}`}
          aria-pressed={!!expr}
        >
          =
        </button>
      </Row>"""
assert a2 in s
s = s.replace(a2, "      </Row>")
open(p, 'w').write(s)
print('ok')
