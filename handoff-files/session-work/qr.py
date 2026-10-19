import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ae2e4fb2496ef2830')
files = {'app/src/components/SeatingView.tsx': 'seat__qr', 'app/src/components/AudienceViews.tsx': 'aud__qr',
         'app/src/components/PollView.tsx': 'poll__qr', 'app/src/components/TriviaView.tsx': 'trv__qr'}
for p, c in files.items():
    s = open(p).read()
    old = '<div className="%s" dangerouslySetInnerHTML={{ __html: j.qr }} />' % c
    assert old in s, (p, old)
    s = s.replace(old, '<QrImage className="%s" svg={j.qr} />' % c)
    lines = s.split('\n')
    i = max(k for k, l in enumerate(lines[:40]) if l.startswith('import '))
    lines.insert(i + 1, "import { QrImage } from './QrImage';")
    open(p, 'w').write('\n'.join(lines))
    css = p.replace('.tsx', '.css')
    t = open(css).read()
    assert ('.%s svg {' % c) in t, css
    t = t.replace('.%s svg {' % c, '.%s svg,\n.%s img {' % (c, c))
    open(css, 'w').write(t)
