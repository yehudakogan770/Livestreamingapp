import { useEffect, useRef, useState } from 'react';
import type { EngineClient, PtzCommand } from '../engine/client';
import type { Ptz } from '../engine/types/Ptz';
import type { Source } from '../engine/types/Source';
import { SourceView } from '../components/SourceView';
import type { Act } from './act';
import './PtzCard.css';

const PRESETS = 8;
const ARROWS: { pan: number; tilt: number; label: string; icon: string }[] = [
  { pan: -1, tilt: 1, label: 'Up and left', icon: '↖' },
  { pan: 0, tilt: 1, label: 'Up', icon: '↑' },
  { pan: 1, tilt: 1, label: 'Up and right', icon: '↗' },
  { pan: -1, tilt: 0, label: 'Left', icon: '←' },
  { pan: 0, tilt: 0, label: 'Straight ahead', icon: '⌂' },
  { pan: 1, tilt: 0, label: 'Right', icon: '→' },
  { pan: -1, tilt: -1, label: 'Down and left', icon: '↙' },
  { pan: 0, tilt: -1, label: 'Down', icon: '↓' },
  { pan: 1, tilt: -1, label: 'Down and right', icon: '↘' },
];

/**
 * Move a PTZ camera: hold an arrow to move, hold + / − to zoom, click a
 * preset to go there (or Store, then a preset, to remember the view).
 */
export function PtzCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const [ptz, setPtz] = useState<Ptz>(() => source.ptz ?? { host: '', port: 0, protocol: 'viscaUdp', presets: [] });
  const [speed, setSpeed] = useState(0.5);
  const [storing, setStoring] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const moving = useRef(false);
  const send = (command: PtzCommand) =>
    client
      .ptz(ptz, command)
      .then(() => setProblem(null))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  const saved = JSON.stringify(ptz) === JSON.stringify(source.ptz ?? null);
  const save = () => act({ type: 'setPtz', id: source.id, ptz });

  // Arrow keys move while held; + and − zoom.
  useEffect(() => {
    const keys: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') onClose();
      const k = keys[e.key];
      if (k && !e.repeat) {
        e.preventDefault();
        void send({ type: 'move', pan: k[0], tilt: k[1], speed });
      }
      if ((e.key === '+' || e.key === '=' || e.key === '-') && !e.repeat) void send({ type: 'zoom', dir: e.key === '-' ? -1 : 1, speed });
    };
    const up = (e: KeyboardEvent) => {
      if (keys[e.key]) void send({ type: 'stop' });
      if (e.key === '+' || e.key === '=' || e.key === '-') void send({ type: 'zoom', dir: 0, speed });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  const hold = (start: PtzCommand, stop: PtzCommand) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      moving.current = true;
      void send(start);
    },
    onPointerUp: () => {
      if (moving.current) void send(stop);
      moving.current = false;
    },
    onPointerCancel: () => {
      if (moving.current) void send(stop);
      moving.current = false;
    },
  });

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="PTZ camera" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box ptz">
        <header className="modal__head">
          <h2>PTZ camera · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="ptz__body">
          <section className="ptz__left">
            <div className="ptz__stage">
              <SourceView source={source} client={client} report={false} />
            </div>
            <div className="ptz__addr">
              <label className="field">
                <span className="field__label">Camera address</span>
                <input
                  className="text"
                  value={ptz.host}
                  placeholder="192.168.1.50"
                  onChange={(e) => setPtz({ ...ptz, host: e.target.value })}
                  aria-label="Camera address"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span className="field__label">Control</span>
                <select value={ptz.protocol} onChange={(e) => setPtz({ ...ptz, protocol: e.target.value as Ptz['protocol'] })} aria-label="Control protocol">
                  <option value="viscaUdp">VISCA over IP (Sony, BirdDog, most)</option>
                  <option value="viscaTcp">VISCA over TCP (PTZOptics)</option>
                </select>
              </label>
              <label className="field ptz__port">
                <span className="field__label">Port</span>
                <input
                  className="text"
                  type="number"
                  min={0}
                  max={65535}
                  value={ptz.port || ''}
                  placeholder={ptz.protocol === 'viscaUdp' ? '52381' : '5678'}
                  onChange={(e) => setPtz({ ...ptz, port: Number(e.target.value) || 0 })}
                  aria-label="Port"
                />
              </label>
            </div>
            {problem && (
              <p className="field__note field__note--warn" role="alert">
                {problem}
              </p>
            )}
          </section>
          <section className="ptz__right">
            <div className="ptz__pad" aria-label="Move">
              {ARROWS.map((a) =>
                a.pan === 0 && a.tilt === 0 ? (
                  <button key={a.label} type="button" className="ptz__btn" aria-label={a.label} onClick={() => void send({ type: 'home' })}>
                    {a.icon}
                  </button>
                ) : (
                  <button
                    key={a.label}
                    type="button"
                    className="ptz__btn"
                    aria-label={a.label}
                    {...hold({ type: 'move', pan: a.pan, tilt: a.tilt, speed }, { type: 'stop' })}
                  >
                    {a.icon}
                  </button>
                ),
              )}
            </div>
            <div className="ptz__zoom">
              <button type="button" className="ptz__btn" aria-label="Zoom out" {...hold({ type: 'zoom', dir: -1, speed }, { type: 'zoom', dir: 0, speed })}>
                −
              </button>
              <span>Zoom</span>
              <button type="button" className="ptz__btn" aria-label="Zoom in" {...hold({ type: 'zoom', dir: 1, speed }, { type: 'zoom', dir: 0, speed })}>
                +
              </button>
              <button type="button" className="btn btn--small" onClick={() => void send({ type: 'autoFocus' })}>
                Auto focus
              </button>
            </div>
            <label className="field">
              <span className="field__label">Speed · {Math.round(speed * 100)}%</span>
              <input type="range" min={0} max={1} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed" />
            </label>
            <span className="field__label">Presets {storing && '— click one to store the view here'}</span>
            <div className="ptz__presets">
              {Array.from({ length: PRESETS }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`seg${storing ? ' is-storing' : ''}`}
                  onClick={() => {
                    void send(storing ? { type: 'store', preset: i } : { type: 'recall', preset: i });
                    setStoring(false);
                  }}
                >
                  {ptz.presets[i] || i + 1}
                </button>
              ))}
            </div>
            <button type="button" className={`btn${storing ? ' is-on' : ''}`} onClick={() => setStoring(!storing)}>
              {storing ? 'Cancel storing' : 'Store the view as a preset…'}
            </button>
            <p className="field__note">Hold an arrow (or the arrow keys) to move; + and − zoom.</p>
          </section>
        </div>
        <footer className="modal__foot">
          {source.ptz && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                act({ type: 'setPtz', id: source.id });
                onClose();
              }}
            >
              Not a PTZ camera
            </button>
          )}
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn--primary" disabled={saved || !ptz.host.trim()} onClick={save}>
            Save address
          </button>
        </footer>
      </div>
    </div>
  );
}
