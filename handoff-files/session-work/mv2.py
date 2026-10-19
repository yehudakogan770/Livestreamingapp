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

edit('views/MultiviewView.tsx',[
('''                label={
                  <>
                    {sc === 'live' ? 'LIVE' : 'BACK'} · Next · {nameOf(show.screens[sc].preview)}
                  </>
                }''','''                label={
                  <>
                    <em className="mv__tally">NEXT</em>
                    <b>{sc === 'live' ? 'LIVE' : 'BACK'}</b>
                    <span className="mv__name">{nameOf(show.screens[sc].preview)}</span>
                    <Timecode />
                  </>
                }'''),
('''                label={
                  <>
                    {sc === 'live' ? 'LIVE' : 'BACK'} · On air · {nameOf(show.screens[sc].program)}
                  </>
                }''','''                label={
                  <>
                    <em className="mv__tally">ON AIR</em>
                    <b>{sc === 'live' ? 'LIVE' : 'BACK'}</b>
                    <span className="mv__name">{nameOf(show.screens[sc].program)}</span>
                    <Timecode />
                  </>
                }'''),
('''        <span>{show.event.name || 'Lumora'}</span>''','''        <LogoMark size={18} />
        <span>{show.event.name || 'Lumora'}</span>
        <span className="mv__sub">Multiview</span>'''),
], "import { Timecode } from './Timecode';\nimport { LogoMark } from '../components/Logo';")

edit('views/MultiviewView.css',[
('''/* Tally: the name strip under a picture takes the tally color, like a hardware multiviewer. */
.mv__box--pgm .mv__label {
  background: var(--program);
  border-top-color: var(--program);
}
.mv__box--pvw .mv__label {
  background: var(--preview);
  border-top-color: var(--preview);
}
.mv__box--pgm .mv__label b,
.mv__box--pvw .mv__label b {
  color: rgba(255, 255, 255, 0.8);
}
.mv__box--pgm .mv__tag,
.mv__box--pvw .mv__tag {
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
}''','''/* Tally: a colored block at the start of the label strip, like a hardware multiviewer. */
.mv__tally {
  align-self: stretch;
  display: flex;
  align-items: center;
  margin: -5px 0 -3px -8px;
  padding: 3px 10px 0;
  font-family: var(--mono);
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #fff;
  background: var(--program);
}
.mv__box--pvw .mv__tally {
  background: var(--preview);
}
.mv__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mv__label .tc {
  margin: 0;
  font-size: 12px;
  color: var(--text-faint);
}
.mv__sub {
  font-weight: 500;
  color: var(--text-faint);
}'''),
])
