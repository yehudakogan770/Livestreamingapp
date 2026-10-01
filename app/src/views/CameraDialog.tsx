import { useEffect, useState } from 'react';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { EngineClient } from '../engine/client';
import type { CameraControls } from '../engine/types/CameraControls';
import { cameraSettings, type CameraSetting } from '../engine/cameras';
import { SourceView } from '../components/SourceView';
import { isCameraLike } from './CameraBar';
import type { Act } from './act';
import './CameraBar.css';

/**
 * Camera control: going through the cameras by itself, and each camera's
 * own settings — zoom, pan and tilt, focus, light, color — with saved shots
 * to go back to in one click. Everything is kept with the event.
 */
export function CameraDialog({ show, act, client, onClose }: { show: Show; act: Act; client: EngineClient; onClose: () => void }) {
  const cams = show.sources.filter(isCameraLike);
  const [tab, setTab] = useState<string>('switch');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const cam = cams.find((c) => c.id === tab);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Camera control" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box camd">
        <header className="modal__head">
          <h2>Camera control</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="camd__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`seg${tab === 'switch' ? ' is-on' : ''}`}
            aria-selected={tab === 'switch'}
            onClick={() => setTab('switch')}
          >
            Switching
          </button>
          {cams.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              className={`seg${tab === c.id ? ' is-on' : ''}`}
              aria-selected={tab === c.id}
              onClick={() => setTab(c.id)}
            >
              {i + 1} · {c.name}
            </button>
          ))}
        </div>
        {cam ? <CameraTab key={cam.id} cam={cam} act={act} client={client} /> : <SwitchTab show={show} cams={cams} act={act} />}
      </div>
    </div>
  );
}

function SwitchTab({ show, cams, act }: { show: Show; cams: Source[]; act: Act }) {
  const a = show.autoSwitch;
  const set = (p: Partial<typeof a>) => act({ type: 'updateAutoSwitch', auto: { ...a, ...p } });
  const chosen = (id: string) => a.cameras.includes(id);
  const toggle = (id: string) => set({ cameras: chosen(id) ? a.cameras.filter((x) => x !== id) : cams.map((c) => c.id).filter((x) => x === id || chosen(x)) });
  const secs = (v: string, d: number) => Math.min(600, Math.max(2, Math.round(Number(v)) || d));
  return (
    <div className="camd__body" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div className="camd__side">
        {cams.length === 0 && <p className="field__note">No cameras yet. Add one with + Add input → Camera (or a phone, or an IP camera).</p>}
        <span className="field__label">Go through these cameras by itself (on the Live Screen)</span>
        <div className="camd__list">
          {cams.map((c, i) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={chosen(c.id)} onChange={() => toggle(c.id)} /> {i + 1} · {c.name}
            </label>
          ))}
        </div>
        <div className="camd__row">
          <span className="field__label">Each shot lasts</span>
          <input
            type="number"
            className="text camd__num"
            min={2}
            max={600}
            value={a.minS}
            onChange={(e) => set({ minS: secs(e.target.value, 6), maxS: Math.max(a.maxS, secs(e.target.value, 6)) })}
            aria-label="Shortest shot, seconds"
          />
          to
          <input
            type="number"
            className="text camd__num"
            min={2}
            max={600}
            value={a.maxS}
            onChange={(e) => set({ maxS: Math.max(a.minS, secs(e.target.value, 10)) })}
            aria-label="Longest shot, seconds"
          />
          seconds
        </div>
        <div className="camd__row">
          <div className="seg-group">
            <button type="button" className={`seg${!a.random ? ' is-on' : ''}`} aria-pressed={!a.random} onClick={() => set({ random: false })}>
              In order
            </button>
            <button type="button" className={`seg${a.random ? ' is-on' : ''}`} aria-pressed={a.random} onClick={() => set({ random: true })}>
              Mixed up
            </button>
          </div>
          <div className="seg-group">
            <button type="button" className={`seg${!a.mix ? ' is-on' : ''}`} aria-pressed={!a.mix} onClick={() => set({ mix: false })}>
              Cut
            </button>
            <button type="button" className={`seg${a.mix ? ' is-on' : ''}`} aria-pressed={a.mix} onClick={() => set({ mix: true })}>
              Quick mix
            </button>
          </div>
        </div>
        <div className="camd__row">
          <button type="button" className={`btn ${a.on ? '' : 'btn--primary'}`} disabled={a.cameras.length < 2} onClick={() => set({ on: !a.on })}>
            {a.on ? 'Stop switching by itself' : 'Start switching by itself'}
          </button>
          {a.cameras.length < 2 && <span className="field__note">Choose at least two cameras.</span>}
        </div>
        <p className="field__note">
          It only switches while one of these cameras is on the Live Screen: put a video, a title or anything else on and it waits, then carries on when a
          camera is back. Overlays (like a logo or a title) stay on top. The camera buttons under Next switch straight to a camera at any time.
        </p>
      </div>
    </div>
  );
}

function CameraTab({ cam, act, client }: { cam: Source; act: Act; client: EngineClient }) {
  const controls: CameraControls = cam.camera ?? { values: [], shots: [] };
  const [settings, setSettings] = useState<CameraSetting[] | null>(null);
  const [shotName, setShotName] = useState('');
  const deviceId = cam.kind.type === 'camera' ? cam.kind.deviceId : null;
  useEffect(() => {
    if (deviceId === null) return;
    let alive = true;
    void cameraSettings(deviceId).then((s) => alive && setSettings(s));
    return () => {
      alive = false;
    };
  }, [deviceId]);
  const valueOf = (s: CameraSetting) => controls.values.find((v) => v.name === s.name)?.value ?? s.now;
  const save = (c: CameraControls) => act({ type: 'setCameraControls', id: cam.id, controls: c });
  const setValue = (name: string, value: number) => save({ ...controls, values: [...controls.values.filter((v) => v.name !== name), { name, value }] });
  const byName = (n: string) => settings?.find((s) => s.name === n);
  const nudge = (n: string, dir: number) => {
    const s = byName(n);
    if (!s) return;
    setValue(n, Math.min(s.max, Math.max(s.min, valueOf(s) + dir * Math.max(s.step, (s.max - s.min) / 20))));
  };
  const auto = (s: CameraSetting) => {
    const m = settings?.find((x) => x.mode === s.name);
    return m ? valueOf(m) >= 1 : false;
  };
  const row = (s: CameraSetting) =>
    s.toggle ? (
      <label key={s.name} className="check">
        <input type="checkbox" checked={valueOf(s) >= 1} onChange={(e) => setValue(s.name, e.target.checked ? 1 : 0)} /> {s.label}
      </label>
    ) : (
      <label key={s.name} className="camd__setting">
        <span>{s.label}</span>
        <input
          type="range"
          min={s.min}
          max={s.max}
          step={s.step}
          value={valueOf(s)}
          disabled={auto(s)}
          onChange={(e) => setValue(s.name, Number(e.target.value))}
          aria-label={s.label}
        />
      </label>
    );
  const moves = settings?.filter((s) => s.group === 'move') ?? [];
  const picture = settings?.filter((s) => s.group === 'picture') ?? [];
  return (
    <div className="camd__body">
      <div className="camd__side">
        <div className="camd__view">
          <SourceView source={cam} client={client} report={false} />
        </div>
        <span className="field__label">Shots (click to go back to one)</span>
        <div className="camd__shots">
          {controls.shots.map((sh, i) => (
            <span key={i} className="camd__shot">
              <button type="button" className="btn" onClick={() => save({ ...controls, values: sh.values })}>
                {sh.name || `Shot ${i + 1}`}
              </button>
              <button
                type="button"
                className="btn"
                aria-label={`Forget ${sh.name || `shot ${i + 1}`}`}
                onClick={() => save({ ...controls, shots: controls.shots.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </span>
          ))}
          {controls.shots.length === 0 && <span className="field__note">No shots saved yet.</span>}
        </div>
        <div className="camd__row">
          <input
            className="text"
            style={{ flex: 1 }}
            value={shotName}
            placeholder="Name this shot (e.g. Speaker close-up)"
            onChange={(e) => setShotName(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!settings?.length}
            onClick={() => {
              const values = (settings ?? []).map((s) => ({ name: s.name, value: valueOf(s) }));
              save({ ...controls, shots: [...controls.shots, { name: shotName.trim() || `Shot ${controls.shots.length + 1}`, values }] });
              setShotName('');
            }}
          >
            Save this shot
          </button>
        </div>
      </div>
      <div className="camd__side">
        {deviceId === null ? (
          <p className="field__note">
            This is {cam.kind.type === 'guest' ? 'a phone or guest' : 'a network camera'}: its zoom, focus and light are set on the device itself. Network
            cameras that move (PTZ) are set up in the input’s ⋯ menu.
          </p>
        ) : settings === null ? (
          <p className="field__note">Asking the camera what it can do…</p>
        ) : settings.length === 0 ? (
          <p className="field__note">This camera doesn’t let the computer change its settings (or it isn’t plugged in).</p>
        ) : (
          <>
            {moves.length > 0 && (
              <>
                <span className="field__label">Move</span>
                {(byName('pan') || byName('tilt')) && (
                  <div className="camd__pad" aria-label="Move the camera">
                    <span />
                    <button type="button" className="btn" disabled={!byName('tilt')} onClick={() => nudge('tilt', 1)} aria-label="Up">
                      ▲
                    </button>
                    <span />
                    <button type="button" className="btn" disabled={!byName('pan')} onClick={() => nudge('pan', -1)} aria-label="Left">
                      ◀
                    </button>
                    <span />
                    <button type="button" className="btn" disabled={!byName('pan')} onClick={() => nudge('pan', 1)} aria-label="Right">
                      ▶
                    </button>
                    <span />
                    <button type="button" className="btn" disabled={!byName('tilt')} onClick={() => nudge('tilt', -1)} aria-label="Down">
                      ▼
                    </button>
                    <span />
                  </div>
                )}
                <div className="camd__grid">{moves.map(row)}</div>
              </>
            )}
            <span className="field__label">Picture</span>
            <div className="camd__grid">{picture.map(row)}</div>
            <div className="camd__row">
              <button type="button" className="btn" disabled={!controls.values.length} onClick={() => save({ ...controls, values: [] })}>
                Stop changing this camera
              </button>
              <span className="field__note">Settings are kept with the event and put back each time.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
