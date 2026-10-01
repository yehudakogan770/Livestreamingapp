import { useState } from 'react';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { EngineClient } from '../engine/client';
import { CameraDialog } from './CameraDialog';
import type { Act } from './act';
import './CameraBar.css';

/** The inputs that count as cameras: cameras, IP cameras and phones / guests. */
export const isCameraLike = (s: Source) => s.kind.type === 'camera' || s.kind.type === 'stream' || s.kind.type === 'guest';

/**
 * One button per camera, under the Next monitor: a click switches straight
 * to it (a cut), red while it is on air, green while it is in Next. AUTO
 * goes through them by itself. ⚙ opens the camera control.
 */
export function CameraBar({ show, screen, act, client }: { show: Show; screen: ScreenId; act: Act; client: EngineClient }) {
  const [open, setOpen] = useState(false);
  const cams = show.sources.filter(isCameraLike);
  if (!cams.length || screen === 'monitor') return open ? <CameraDialog show={show} act={act} client={client} onClose={() => setOpen(false)} /> : null;
  const sc = show.screens[screen];
  const auto = show.autoSwitch;
  const toggleAuto = () => {
    const list = auto.cameras.length >= 2 ? auto.cameras : cams.map((c) => c.id);
    if (list.length < 2) return setOpen(true);
    act({ type: 'updateAutoSwitch', auto: { ...auto, cameras: list, on: !auto.on } });
  };
  return (
    <div className="cambar" role="group" aria-label="Cameras">
      <span className="cambar__label">Cameras</span>
      {cams.map((c, i) => (
        <button
          key={c.id}
          type="button"
          className={`btn cambar__btn${sc.program === c.id ? ' is-on' : sc.preview === c.id ? ' is-next' : ''}${auto.on && auto.cameras.includes(c.id) ? ' is-auto' : ''}`}
          title={`${c.name} — click: straight on air · right-click: line up in Next`}
          onClick={() => act({ type: 'cutTo', screen, sourceId: c.id })}
          onContextMenu={(e) => {
            e.preventDefault();
            act({ type: 'setPreview', screen, sourceId: c.id });
          }}
        >
          <b>{i + 1}</b>
          <span>{c.name}</span>
        </button>
      ))}
      {screen === 'live' && cams.length >= 2 && (
        <button
          type="button"
          className={`btn cambar__auto${auto.on ? ' is-on' : ''}`}
          aria-pressed={auto.on}
          title={auto.on ? 'Stop switching by itself' : 'Go through the cameras by itself'}
          onClick={toggleAuto}
        >
          Auto
        </button>
      )}
      <button
        type="button"
        className="btn cambar__gear"
        title="Camera control: switching, zoom, focus, light, color, shots"
        aria-label="Camera control"
        onClick={() => setOpen(true)}
      >
        ⚙
      </button>
      {open && <CameraDialog show={show} act={act} client={client} onClose={() => setOpen(false)} />}
    </div>
  );
}
