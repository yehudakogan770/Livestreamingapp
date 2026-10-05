import { useEffect, useRef, useState } from 'react';
import type { Project } from '../model/project';
import { shotAt, type Player } from '../player/player';
import { usePlayhead } from './hooks';

/** Every camera at once. Click one (or press its number) to switch to it from the playhead. */
export function CameraWall({ project, player, onSwitch }: { project: Project; player: Player; onSwitch: (angle: string) => void }) {
  const t = usePlayhead(player);
  const shot = shotAt(project, t);
  const on = shot ? (shot.b && shot.b.mix > 0.5 ? shot.b.angle : shot.a.angle) : null;
  const [all, setAll] = useState(player.wall);
  return (
    <section className="wall" aria-label="Cameras">
      <div className="panel__head">
        <h2>Cameras</h2>
        <span className="panel__hint">Click or press 1–9 to switch</span>
      </div>
      <div className={`wall__grid${project.angles.length > 4 ? ' is-many' : ''}`}>
        {project.angles.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className={`wall__tile${on === a.id ? ' is-on' : ''}`}
            onClick={() => onSwitch(a.id)}
            title={`Switch to ${a.name} from the playhead (${i + 1})`}
          >
            <Tile player={player} angle={a.id} />
            <span className="wall__label">
              <b style={{ background: a.color }}>{i + 1}</b>
              {a.name}
            </span>
            {on === a.id && <span className="wall__on">ON</span>}
          </button>
        ))}
      </div>
      <label className="check wall__all" title="Turn off on a slow computer: only the camera that is on plays">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => {
            player.wall = e.target.checked;
            setAll(e.target.checked);
            player.seek(player.time);
          }}
        />
        Play every camera
      </label>
    </section>
  );
}

/** Puts the camera's own video element in the tile. */
function Tile({ player, angle }: { player: Player; angle: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const video = player.videoFor(angle);
  useEffect(() => {
    const el = box.current;
    if (el && video) el.appendChild(video);
    return () => {
      if (video?.parentElement === el) video.remove();
    };
  }, [video]);
  return <span className="wall__video" ref={box} />;
}
