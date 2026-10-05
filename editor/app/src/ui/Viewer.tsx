import { useEffect, useRef } from 'react';
import { clockTime, layout, timecode, type Project } from '../model/project';
import { shotAt, type Player } from '../player/player';
import type { Actions } from './Editor';
import { usePlayhead, usePlaying, useSpeed } from './hooks';

/** The picture of the film, and the play controls. */
export function Viewer({ project, player, actions }: { project: Project; player: Player; actions: Actions }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    player.setCanvas(canvas.current);
    return () => player.setCanvas(null);
  }, [player]);
  return (
    <section className="viewer" aria-label="Viewer">
      <div className="viewer__screen">
        <canvas ref={canvas} width={1280} height={720} onClick={() => player.toggle()} />
        <Overlay project={project} player={player} />
      </div>
      <Transport project={project} player={player} actions={actions} />
    </section>
  );
}

function Overlay({ project, player }: { project: Project; player: Player }) {
  const t = usePlayhead(player);
  const shot = shotAt(project, t);
  const on = shot ? (shot.b && shot.b.mix > 0.5 ? shot.b.angle : shot.a.angle) : null;
  const angle = project.angles.find((a) => a.id === on);
  const clock = shot ? clockTime(project.startedAt, shot.event) : '';
  return (
    <div className="viewer__over">
      {angle && (
        <span className="viewer__tag">
          <i style={{ background: angle.color }} />
          {angle.name}
        </span>
      )}
      {clock && <span className="viewer__clock">{clock}</span>}
    </div>
  );
}

function Transport({ project, player, actions }: { project: Project; player: Player; actions: Actions }) {
  const t = usePlayhead(player);
  const playing = usePlaying(player);
  const speed = useSpeed(player);
  const total = layout(project.clips).total;
  const frame = 1000 / 30;
  return (
    <div className="transport">
      <button type="button" className="tbtn" onClick={() => player.seek(0)} title="To the start (Home)" aria-label="To the start">
        ⏮
      </button>
      <button type="button" className="tbtn" onClick={actions.prevCut} title="Previous cut (↑)" aria-label="Previous cut">
        ⇤
      </button>
      <button type="button" className="tbtn" onClick={() => player.seek(t - frame)} title="One frame back (←)" aria-label="One frame back">
        ◀
      </button>
      <button type="button" className="tbtn tbtn--play" onClick={() => player.toggle()} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button type="button" className="tbtn" onClick={() => player.seek(t + frame)} title="One frame on (→)" aria-label="One frame on">
        ▶
      </button>
      <button type="button" className="tbtn" onClick={actions.nextCut} title="Next cut (↓)" aria-label="Next cut">
        ⇥
      </button>
      <button type="button" className="tbtn" onClick={() => player.seek(total)} title="To the end (End)" aria-label="To the end">
        ⏭
      </button>
      <span className="transport__time">
        <b>{timecode(t, true)}</b> / {timecode(total)}
        {playing && speed !== 1 && <em> {speed}×</em>}
      </span>
      <span className="grow" />
      <button type="button" className="btn btn--sm" onClick={actions.markIn} title="Mark where the part to export starts (I)">
        Mark start
      </button>
      <button type="button" className="btn btn--sm" onClick={actions.markOut} title="Mark where the part to export ends (O)">
        Mark end
      </button>
      {project.range && (
        <button type="button" className="btn btn--sm" onClick={actions.clearMarks} title="Clear the marks (X)">
          Clear
        </button>
      )}
    </div>
  );
}
