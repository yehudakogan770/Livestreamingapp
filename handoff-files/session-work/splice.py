p='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/views/ControlView.css'
s=open(p).read()
a=s.index('/* ---- monitors + switcher ---- */')
b=s.index('/* ---- monitor tab ---- */')
new=open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/stage.css').read()
s=s[:a]+new+s[b:]

def rep(old,new,count=1):
    global s
    assert old in s, old[:80]
    s=s.replace(old,new,count)

rep('''.mon__fit {
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
}
.mon__fit > .mon__screen {
  /* Head, gaps and the line under the picture (measured by useFitLayout). */
  width: min(100cqw, calc((100cqh - var(--mon-chrome, 64px)) * 16 / 9));
  max-height: none;
  flex: 0 0 auto;
}''','''.mon__fit {
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
}
.mon__fit > .mon__win {
  /* The label strip, gaps and the line under the picture (measured by useFitLayout). */
  width: min(100cqw, calc((100cqh - var(--mon-chrome, 64px)) * 16 / 9));
  flex: 0 0 auto;
}
.mon__fit .mon__screen {
  max-height: none;
}''')
rep('''.control__work.is-side .centre__more {
  flex: 0 0 262px;
  padding-top: 28px;
}''','''.control__work.is-side .centre__more {
  flex: 0 0 262px;
}''')
rep('''@container (max-height: 760px) {
  .switch {
    gap: 5px;
  }
  .switch__take {
    height: 46px;
    font-size: 17px;
  }
  .switch__cut {
    height: 32px;
  }''','''@container (max-height: 760px) {
  .switch__body {
    gap: 6px;
    padding: 6px;
  }
  .switch__take,
  .switch__cut {
    height: 44px;
  }
  .switch__take {
    font-size: 17px;
  }
  .bus__key {
    height: 30px;
  }
  .bus__key small {
    display: none;
  }
  .bus__keys {
    max-height: 63px;
  }''')
rep('''  .switch .tbar__track {
    height: 24px;
  }''','''  .switch .tbar__track {
    height: 22px;
  }
  .switch .tbar__labels {
    display: none;
  }''')
rep('''@media (max-height: 820px) {
  .selector {
    height: 48px;
  }
  .selector__tab {
    height: 38px;
  }
  .bar {
    height: 44px;
  }
  .bar .btn {
    height: 30px;
  }
}''','''@media (max-height: 820px) {
  .selector {
    height: 40px;
  }
  .selector__tab {
    height: 30px;
  }
  .titlebar {
    height: 36px;
  }
}''')
# old later mon__snap block and mon__tag overrides
a=s.index('''.mon__snap {
  margin-left: auto;''')
b=s.index('''/* The countdown on the main page''')
s=s[:a]+s[b:]
rep('''.stage .mon__tag {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}''','''.stage .mon__tag {
  white-space: nowrap;
}''')
open(p,'w').write(s)
