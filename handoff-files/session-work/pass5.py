import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

f = File('editor/app/src/ui/ProjectPanel.tsx')
f.rep("""            ['media', 'Media'],
            ['effects', 'Effects'],
            ['text', 'Text & more'],
          ] as [Tab, string][]
        ).map(([t, name]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
            {name}
          </button>""", """            ['media', 'Media', FolderOpen],
            ['effects', 'Effects', Blend],
            ['text', 'Text & more', Type],
          ] as [Tab, string, LucideIcon][]
        ).map(([t, name, Icon]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
            <Icon />
            {name}
          </button>""", icons=['FolderOpen', 'Blend', 'Type', 'type LucideIcon'])
f.rep("""          title="Add video, sound and pictures (Ctrl+I)"
        >
          Import…""", """          title="Add video, sound and pictures (Ctrl+I)"
        >
          <Import />
          Import…""", icons=['Import'])
f.rep("""title="A folder to keep things tidy">
          New bin""", """title="A folder to keep things tidy">
          <FolderPlus />
          Bin""", icons=['FolderPlus'])
f.rep("""title="A new timeline">
          New sequence""", """title="A new timeline">
          <SquarePlus />
          Sequence""", icons=['SquarePlus'])
f.rep("""            <span className="media__icon">▤</span>""", """            <Clapperboard className="media__icon" />""", icons=['Clapperboard'])
f.rep("""                    {isOpen ? '▾' : '▸'}
                  </button>""", """                    {isOpen ? <ChevronDown /> : <ChevronRight />}
                    {isOpen ? <FolderOpen className="media__folder" /> : <Folder className="media__folder" />}
                  </button>""", icons=['ChevronDown', 'ChevronRight', 'Folder'])
f.rep("""        {m.kind === 'audio' && '♪'}
        {m.kind === 'video' && !strip && '▶'}""", """        {m.kind === 'audio' && <AudioLines />}
        {m.kind === 'video' && !strip && <FileVideo />}""", icons=['AudioLines', 'FileVideo'])
f.rep("""                onClick={() => actions.transition(kind, t.type)}
              >
                {t.name}""", """                onClick={() => actions.transition(kind, t.type)}
              >
                <ArrowRightLeft />
                {t.name}""", icons=['ArrowRightLeft'])
f.rep("""                onClick={() => actions.addEffect(ids, e.type)}
              >
                {e.name}""", """                onClick={() => actions.addEffect(ids, e.type)}
              >
                {e.kind === 'audio' ? <AudioLines /> : <SlidersHorizontal />}
                {e.name}""", icons=['SlidersHorizontal'])
f.rep("""onClick={() => actions.addGenerator(g.gen)}>
            {g.name}""", """onClick={() => actions.addGenerator(g.gen)}>
            <Square />
            {g.name}""", icons=['Square'])
f.rep("""onClick={() => actions.addShape(kind)}>
            {name}""", """onClick={() => actions.addShape(kind)}>
            <Shapes />
            {name}""", icons=['Shapes'])
f.rep("""                Could not be read ✕""", """                Could not be read <X />""")
f.save()
