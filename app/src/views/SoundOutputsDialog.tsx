import { useEffect, useState } from 'react';
import type { AudioOutputId } from '../engine/types/AudioOutputId';
import type { Show } from '../engine/types/Show';
import { canChooseSpeakers } from '../audio/soundEngine';
import type { Act } from './act';

/** Choose which speakers or sound device each mix plays on, and name the mixes. */
export function SoundOutputsDialog({ show, act, onClose }: { show: Show; act: Act; onClose: () => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [nameA, setNameA] = useState(show.audio.a.name);
  const [nameB, setNameB] = useState(show.audio.b.name);
  // Chosen here, applied on Done.
  const [outs, setOuts] = useState({ ...show.settings.audioOutputs });
  const choose = canChooseSpeakers();

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    // Names of devices are only shown after sound permission is given.
    void md
      .getUserMedia({ audio: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => {})
      .finally(() => md.enumerateDevices().then((all) => setDevices(all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'))));
  }, []);

  const done = () => {
    if (nameA !== show.audio.a.name) act({ type: 'updateBus', bus: 'a', patch: { name: nameA } });
    if (nameB !== show.audio.b.name) act({ type: 'updateBus', bus: 'b', patch: { name: nameB } });
    for (const id of ['master', 'a', 'b', 'headphones'] as const) {
      if (outs[id] !== show.settings.audioOutputs[id]) act({ type: 'setAudioOutput', output: id, deviceId: outs[id] ?? undefined });
    }
    onClose();
  };
  const close = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  });

  const row = (id: AudioOutputId, title: React.ReactNode, hint: string, emptyName: string) => (
    <div className="outputs__row outputs__row--sound">
      <div className="outputs__screen">
        {title}
        <span>{hint}</span>
      </div>
      <select
        aria-label={`Speakers for ${id}`}
        value={outs[id] ?? ''}
        disabled={!choose && id !== 'master'}
        onChange={(e) => setOuts((o) => ({ ...o, [id]: e.target.value || null }))}
      >
        <option value="">{emptyName}</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Sound device ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Speakers" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal__box outputs">
        <header className="modal__head">
          <h2>Speakers and mixes</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={close}>
            ✕
          </button>
        </header>
        <p className="outputs__intro">
          Each mix can play on its own speakers or sound device. The Stream mix is what the live stream and recording hear by default.
          {!choose && <strong> Choosing speakers works in the Windows version; here everything plays on the default speakers.</strong>}
        </p>
        <div className="outputs__rows">
          {row('master', <strong>Stream</strong>, 'The main mix', "Computer's default speakers")}
          {row(
            'a',
            <input className="text" value={nameA} maxLength={24} onChange={(e) => setNameA(e.target.value)} aria-label="Name of mix A" />,
            'e.g. the hall speakers',
            'Not played',
          )}
          {row(
            'b',
            <input className="text" value={nameB} maxLength={24} onChange={(e) => setNameB(e.target.value)} aria-label="Name of mix B" />,
            'e.g. a separate recording mix',
            'Not played',
          )}
          {row('headphones', <strong>Headphones</strong>, 'Hears the Stream mix, or the input you solo (S)', 'Not played')}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={done}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
