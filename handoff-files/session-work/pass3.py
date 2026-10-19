import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

f = File('editor/app/src/ui/Monitors.tsx')
f.rep("""        <span className="vmon__title">Program: {s.name}</span>""", """        <span className="vmon__title">
          <MonitorPlay />
          Program <small>{s.name}</small>
        </span>""", icons=['MonitorPlay'])
f.rep("""            onClick={() => ui.set({ showMatte: !u.showMatte })}
          >
            Matte
          </button>""", """            onClick={() => ui.set({ showMatte: !u.showMatte })}
          >
            <Contrast />
            Matte
          </button>""", icons=['Contrast'])
f.rep("""  const playing = usePlaying(engine);
  return (
    <div className="vtransport">
      <PlayheadTime engine={engine} fps={fps} big />
      <span className="vtransport__fill" />
      <button type="button" className="tbtn" title="Mark in (I)" aria-label="Mark in" onClick={actions.markIn}>
        {'{'}
      </button>
      <button type="button" className="tbtn" title="Mark out (O)" aria-label="Mark out" onClick={actions.markOut}>
        {'}'}
      </button>
      <button type="button" className="tbtn" title="Go to in (Shift+I)" aria-label="Go to in" onClick={actions.toIn}>
        {'{←'}
      </button>
      <button type="button" className="tbtn" title="Step back one frame (←)" aria-label="Step back" onClick={() => actions.step(-1)}>
        ◂|
      </button>
      <button type="button" className="tbtn tbtn--play" aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)" onClick={actions.toggle}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button type="button" className="tbtn" title="Step forward one frame (→)" aria-label="Step forward" onClick={() => actions.step(1)}>
        |▸
      </button>
      <button type="button" className="tbtn" title="Go to out (Shift+O)" aria-label="Go to out" onClick={actions.toOut}>
        {'→}'}
      </button>
      <button type="button" className="tbtn" title="Lift the marked part (;)" aria-label="Lift" onClick={actions.liftMarked}>""", """  const playing = usePlaying(engine);
  const [loop, setLoop] = useState(engine.loop);
  return (
    <div className="vtransport">
      <PlayheadTime engine={engine} fps={fps} big />
      <span className="vtransport__fill" />
      <span className="vtransport__group">
        <button type="button" className="tbtn tbtn--icon" title="Mark in (I)" aria-label="Mark in" onClick={actions.markIn}>
          <MarkIn />
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Mark out (O)" aria-label="Mark out" onClick={actions.markOut}>
          <MarkOut />
        </button>
      </span>
      <span className="vtransport__group">
        <button type="button" className="tbtn tbtn--icon" title="Go to in (Shift+I)" aria-label="Go to in" onClick={actions.toIn}>
          <ArrowLeftToLine />
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Step back one frame (←)" aria-label="Step back" onClick={() => actions.step(-1)}>
          <StepBack />
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Stop" aria-label="Stop" onClick={actions.stop}>
          <Square />
        </button>
        <button
          type="button"
          className={`tbtn tbtn--play${playing ? ' is-on' : ''}`}
          aria-label={playing ? 'Pause' : 'Play'}
          title="Play / pause (Space)"
          onClick={actions.toggle}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Step forward one frame (→)" aria-label="Step forward" onClick={() => actions.step(1)}>
          <StepForward />
        </button>
        <button type="button" className="tbtn tbtn--icon" title="Go to out (Shift+O)" aria-label="Go to out" onClick={actions.toOut}>
          <ArrowRightToLine />
        </button>
        <button
          type="button"
          className={`tbtn tbtn--icon${loop ? ' is-on' : ''}`}
          title="Loop: play the marked part over and over"
          aria-label="Loop"
          aria-pressed={loop}
          onClick={() => {
            actions.toggleLoop();
            setLoop(engine.loop);
          }}
        >
          <Repeat />
        </button>
      </span>
      <span className="vtransport__group">
      <button type="button" className="tbtn" title="Lift the marked part (;)" aria-label="Lift" onClick={actions.liftMarked}>""", icons=['ArrowLeftToLine', 'StepBack', 'Square', 'Pause', 'Play', 'StepForward', 'ArrowRightToLine', 'Repeat'])
f.rep("""        <FoldHorizontal />
      </button>
      <span className="vtransport__fill" />""", """        <FoldHorizontal />
      </button>
      </span>
      <span className="vtransport__fill" />""")
f.rep("className=\"tbtn\" title=\"Lift the marked part (;)\"", "className=\"tbtn tbtn--icon\" title=\"Lift the marked part (;)\"")
f.rep("className=\"tbtn\" title=\"Extract the marked part and close up (')\"", "className=\"tbtn tbtn--icon\" title=\"Extract the marked part and close up (')\"")
f.rep("""          className={`tbtn${u.safeMargins ? ' is-on' : ''}`}""", """          className={`tbtn tbtn--icon${u.safeMargins ? ' is-on' : ''}`}
          aria-label="Safe margins\"""")
# source monitor
f.rep("""            <button type="button" className="tbtn" title="Mark in (I)" aria-label="Mark in" disabled={!m} onClick={() => mark('in')}>
              {'{'}
            </button>
            <button type="button" className="tbtn" title="Mark out (O)" aria-label="Mark out" disabled={!m} onClick={() => mark('out')}>
              {'}'}
            </button>""", """            <button type="button" className="tbtn tbtn--icon" title="Mark in (I)" aria-label="Mark in" disabled={!m} onClick={() => mark('in')}>
              <MarkIn />
            </button>
            <button type="button" className="tbtn tbtn--icon" title="Mark out (O)" aria-label="Mark out" disabled={!m} onClick={() => mark('out')}>
              <MarkOut />
            </button>""")
f.rep("""              {playing ? '❚❚' : '▶'}""", """              {playing ? <Pause /> : <Play />}""")
f.rep("""{m?.kind === 'audio' && <span className="vmon__audioonly">♪ {m.name}</span>}""", """{m?.kind === 'audio' && (
              <span className="vmon__audioonly">
                <AudioLines />
                {m.name}
              </span>
            )}""", icons=['AudioLines'])
f.rep("import { TrackOverlay } from './Tracking';", "import { TrackOverlay } from './Tracking';\nimport { MarkIn, MarkOut } from './icons';")
f.save()
print(f.s.count('tbtn'))
