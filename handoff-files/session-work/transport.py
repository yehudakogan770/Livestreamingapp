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

edit('views/Transport.tsx',[
('''      <button type="button" className="icon" aria-label="Back to start" onClick={() => seek(0)}>
        ⏮
      </button>
      <button type="button" className="icon" aria-label="Back 10 seconds" onClick={() => seek(pos - 10)}>
        −10
      </button>''','''      <button type="button" className="icon" aria-label="Back to start" title="Back to start" onClick={() => seek(0)}>
        <SkipBack aria-hidden="true" />
      </button>
      <button type="button" className="icon" aria-label="Back 10 seconds" title="Back 10 seconds" onClick={() => seek(pos - 10)}>
        <RotateCcw aria-hidden="true" />
        <small>10</small>
      </button>'''),
('''        aria-label={playback.playing ? 'Pause' : 'Play'}
        onClick={() => act({ type: playback.playing ? 'pause' : 'play', id: source.id })}
      >
        {playback.playing ? '❚❚' : '▶'}
      </button>
      <button type="button" className="icon" aria-label="Forward 10 seconds" onClick={() => seek(pos + 10)}>
        +10
      </button>''','''        aria-label={playback.playing ? 'Pause' : 'Play'}
        title={playback.playing ? 'Pause' : 'Play'}
        onClick={() => act({ type: playback.playing ? 'pause' : 'play', id: source.id })}
      >
        {playback.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <button type="button" className="icon" aria-label="Forward 10 seconds" title="Forward 10 seconds" onClick={() => seek(pos + 10)}>
        <RotateCw aria-hidden="true" />
        <small>10</small>
      </button>'''),
('''        aria-pressed={source.looping}
        onClick={() => act({ type: 'updateSource', id: source.id, patch: { looping: !source.looping } })}
      >
        Loop''','''        aria-pressed={source.looping}
        title="Play it again and again"
        onClick={() => act({ type: 'updateSource', id: source.id, patch: { looping: !source.looping } })}
      >
        <Repeat aria-hidden="true" />
        Loop'''),
], "import { Pause, Play, Repeat, RotateCcw, RotateCw, SkipBack } from 'lucide-react';")
