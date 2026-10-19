p='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/views/ControlView.tsx'
s=open(p).read()
def rep(old,new,count=1):
    global s
    assert old in s, old[:80]
    s=s.replace(old,new,count)
rep('''                {arr('bottom', 'inputs', 'Inputs')}
                <PresetButtons show={show} act={act} showAll={showAll} onShowAll={setShowAll} />''','''                {arr('bottom', 'inputs', 'Inputs')}
                <div className="phead">
                  <LayoutGrid aria-hidden="true" />
                  <span className="phead__title">Inputs</span>
                  <span className="phead__meta">{screenInputs(show, screen).length}</span>
                  <span className="phead__hint">Click: line up in Next · Double-click: straight to air</span>
                </div>
                <PresetButtons show={show} act={act} showAll={showAll} onShowAll={setShowAll} />''')
rep("import { Camera } from 'lucide-react';","import { Camera, LayoutGrid, OctagonAlert, Monitor, Projector, RadioTower, Link2, MonitorUp } from 'lucide-react';")
# bottom bar
rep('''        <button type="button" className="btn" onClick={() => setOutputsOpen(true)}>
          Outputs
          <span''','''        <button type="button" className="btn" onClick={() => setOutputsOpen(true)} title="Open, close and place the output windows">
          <MonitorUp aria-hidden="true" />
          Outputs
          <span''')
rep('''          onClick={() => act({ type: 'setBackFollowsLive', value: !show.backFollowsLive })}
        >
          Back = Live''','''          onClick={() => act({ type: 'setBackFollowsLive', value: !show.backFollowsLive })}
        >
          <Link2 aria-hidden="true" />
          Back = Live''')
rep('''        <span className="grow" />
        <span className="bar__label">Blank</span>
        {SCREENS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`btn btn--blank${show.screens[s.id].blank ? ' is-on' : ''}`}
            aria-pressed={show.screens[s.id].blank}
            onClick={() => act({ type: 'setBlank', screens: [s.id], value: !show.screens[s.id].blank })}
          >
            {s.id === 'live' ? 'Live' : s.id === 'back' ? 'Back' : 'Monitor'}
          </button>
        ))}''','''        <span className="grow" />
        <span className="bar__group" role="group" aria-label="Blank a screen">
          <span className="bar__label">Blank</span>
          {SCREENS.map((s) => {
            const Icon = s.id === 'live' ? RadioTower : s.id === 'back' ? Projector : Monitor;
            return (
              <button
                key={s.id}
                type="button"
                className={`btn btn--blank${show.screens[s.id].blank ? ' is-on' : ''}`}
                aria-pressed={show.screens[s.id].blank}
                title={`Blank the ${s.name} (show black)`}
                onClick={() => act({ type: 'setBlank', screens: [s.id], value: !show.screens[s.id].blank })}
              >
                <Icon aria-hidden="true" />
                {s.id === 'live' ? 'Live' : s.id === 'back' ? 'Back' : 'Monitor'}
              </button>
            );
          })}
        </span>''')
rep('''      {on ? 'PANIC ON · click to undo' : hint ? 'Double-click to confirm' : 'PANIC'}''','''      <OctagonAlert aria-hidden="true" />
      {on ? 'PANIC ON · click to undo' : hint ? 'Double-click to confirm' : 'PANIC'}''')
open(p,'w').write(s)
