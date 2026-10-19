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

edit('broadcast/BroadcastButtons.tsx',[
('''        onClick={() => press('stream')}
      >
        <i className="bc-dot" />''','''        onClick={() => press('stream')}
      >
        <Radio className="bc-live" aria-hidden="true" />'''),
('''        ⟲ REPLAY
      </button>''','''        <History aria-hidden="true" />
        REPLAY
      </button>'''),
('''        ⟲ {secs}s{slow ? ' ½×' : ''}''','''        <History aria-hidden="true" />
        {secs}s{slow ? ' ½×' : ''}'''),
('''aria-label="Replay options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        ▾
      </button>''','''aria-label="Replay options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        <ChevronDown aria-hidden="true" />
      </button>'''),
], "import { ChevronDown, History, Radio } from 'lucide-react';")

edit('broadcast/PerfChip.tsx',[
('''        onClick={() => setOpen(!open)}
      >
        {label}
      </button>''','''        onClick={() => setOpen(!open)}
      >
        <Cpu aria-hidden="true" />
        {label}
      </button>'''),
], "import { Cpu } from 'lucide-react';")
