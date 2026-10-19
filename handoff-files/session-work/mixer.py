p='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/views/Mixer.tsx'
s=open(p).read()
def rep(old,new,count=1):
    global s
    assert old in s, old[:80]
    s=s.replace(old,new,count)
first_import=s.index('import ')
s=s[:first_import]+"import { AudioLines, Headphones, Settings2, Speaker, VolumeX } from 'lucide-react';\n"+s[first_import:]
rep('''      <div className="mixer__head">
        <span className="mixer__title">Audio mixer</span>
        {!sound && <span className="mixer__note">sound starts inside Lumora</span>}
        <span className="grow" />
        <button type="button" className="chip" onClick={() => setOutputs(true)}>
          Speakers…
        </button>
      </div>''','''      <div className="phead mixer__head">
        <AudioLines aria-hidden="true" />
        <span className="mixer__title">Audio mixer</span>
        {!sound && <span className="mixer__note">sound starts inside Lumora</span>}
        <span className="grow" />
        <button type="button" className="btn" onClick={() => setOutputs(true)} title="Choose the speakers each mix plays on">
          <Speaker aria-hidden="true" />
          Speakers…
        </button>
      </div>''')
rep('''      <button type="button" className="strip__name" title={`${src.name} · settings`} onClick={() => setMenu(!menu)}>
        {src.name}
      </button>''','''      <button type="button" className="strip__name" title={`${src.name} · settings`} onClick={() => setMenu(!menu)}>
        <span>{src.name}</span>
        <Settings2 aria-hidden="true" />
      </button>''')
rep('''          aria-pressed={src.muted}
          title="Mute"
          onClick={() => act({ type: 'updateSource', id: src.id, patch: { muted: !src.muted } })}
        >
          M
        </button>''','''          aria-pressed={src.muted}
          aria-label="Mute"
          title="Mute"
          onClick={() => act({ type: 'updateSource', id: src.id, patch: { muted: !src.muted } })}
        >
          <VolumeX aria-hidden="true" />
        </button>''')
rep('''          aria-pressed={soloed}
          title="Solo: hear it alone in the headphones"
          onClick={() => act({ type: 'setSolo', sourceId: soloed ? null : src.id })}
        >
          S
        </button>''','''          aria-pressed={soloed}
          aria-label="Solo"
          title="Solo: hear it alone in the headphones"
          onClick={() => act({ type: 'setSolo', sourceId: soloed ? null : src.id })}
        >
          <Headphones aria-hidden="true" />
        </button>''')
rep('''        <button type="button" className={`sbtn sbtn--mute${muted ? ' is-on' : ''}`} aria-pressed={muted} title="Mute this mix" onClick={onMute}>
          M
        </button>''','''        <button
          type="button"
          className={`sbtn sbtn--mute${muted ? ' is-on' : ''}`}
          aria-pressed={muted}
          aria-label="Mute"
          title="Mute this mix"
          onClick={onMute}
        >
          <VolumeX aria-hidden="true" />
        </button>''')
open(p,'w').write(s)

t='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/App.test.tsx'
s=open(t).read()
s=s.replace("getAllByRole('button', { name: 'M' })[0]!;","getAllByRole('button', { name: 'Mute' })[0]!;")
s=s.replace("""getAllByRole('button', {
        name: 'M',
      })[0],""","""getAllByRole('button', {
        name: 'Mute',
      })[0],""")
open(t,'w').write(s)
