import re
R = '/home/user/Livestreamingapp/.claude/worktrees/agent-a22c0ed40f10ed52f/editor/app/src/'


def fix(rel, pairs):
    p = R + rel
    s = open(p).read()
    for a, b in pairs:
        n = s.count(a)
        assert n == 1, (rel, a[:60], n)
        s = s.replace(a, b)
    open(p, 'w').write(s)


fix('extras/extras.css', [("""  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
}""", """  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
}""")])
fix('ui/delivery.css', [
    ("""  color: var(--text-faint);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.dlv__del {""", """  color: var(--text-dim);
  font-size: 12px;
}
.dlv__del {"""),
    ("""  background: var(--bar);
  color: var(--text-faint);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}""", """  background: var(--bar);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
}"""),
    (""".sbins__head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  color: var(--text-faint);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}""", """.sbins__head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  padding: 0 4px 0 8px;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
}
.sbins__head > svg.lucide {
  width: 15px;
  height: 15px;
  color: var(--text-faint);
}"""),
    (""".sbins__bin {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 6px;""", """.sbins__bin {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 28px;
  padding: 0 8px;"""),
])
print('ok')
