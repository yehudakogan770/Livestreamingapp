import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/designer/Designer.tsx', [
("""    ['hand', 'Hand (move the view)', <Hand key="h" size={16} />, 'H'],
  ];""", """    ['hand', 'Hand (move the view)', <Hand key="h" size={16} />, 'H'],
    ['note', 'Note (pin a note on the canvas)', <MessageSquare key="n" size={16} />, 'N'],
  ];"""),
("""                  ['motionPaths', 'Motion paths'],
                ] as const""", """                  ['motionPaths', 'Motion paths'],
                  ['notes', 'Notes'],
                ] as const"""),
("""  Maximize2,
  Minimize2,
} from 'lucide-react';""", """  Maximize2,
  Minimize2,
  MessageSquare,
} from 'lucide-react';"""),
("""        <section className="tt-center">""", """        <NotesPopover store={store} />
        <section className="tt-center">"""),
("import { HistoryPanel } from './HistoryPanel';", "import { HistoryPanel } from './HistoryPanel';\nimport { NotesPanel, NotesPopover } from './Notes';"),
("""          {side === 'history' && <HistoryPanel store={store} />}""", """          {side === 'history' && (
            <>
              <NotesPanel store={store} />
              <HistoryPanel store={store} />
            </>
          )}"""),
])
print('ok')
