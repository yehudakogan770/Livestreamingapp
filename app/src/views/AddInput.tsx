import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { NewSource } from '../engine/types/NewSource';
import type { SourceKind } from '../engine/types/SourceKind';
import { SourceView } from '../components/SourceView';

type Kind = SourceKind['type'];

const KINDS: { kind: Kind; name: string; hint: string }[] = [
  { kind: 'camera', name: 'Camera', hint: 'Webcam, capture card or phone' },
  { kind: 'video', name: 'Video file', hint: 'MP4, MOV, WebM…' },
  { kind: 'image', name: 'Picture', hint: 'PNG, JPG, logo…' },
  { kind: 'color', name: 'Colour', hint: 'A solid colour' },
  { kind: 'pattern', name: 'Test pattern', hint: 'Colour bars for setup' },
];

const SWATCHES = ['#000000', '#ffffff', '#1f6f79', '#0b2545', '#3b1c32', '#c7372f', '#d4a017', '#2f8f4e'];

/** Choose what kind of input to add, set it up, and add it. */
export function AddInput({ client, onAdd, onClose }: { client: EngineClient; onAdd: (source: NewSource) => void; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('camera');
  const [name, setName] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const [color, setColor] = useState('#1f6f79');
  const [looping, setLooping] = useState(true);
  const [cams, setCams] = useState<MediaDeviceInfo[] | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [cam, setCam] = useState<MediaDeviceInfo | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // Cameras are listed once permission is given, so their real names show.
  useEffect(() => {
    if (kind !== 'camera' || cams !== null) return;
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) {
      setCams([]);
      setCamErr('Cameras are not available here.');
      return;
    }
    md.getUserMedia({ video: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => setCamErr('Lumora was not allowed to use cameras, or none is plugged in.'))
      .finally(() =>
        md.enumerateDevices().then((all) => {
          const list = all.filter((d) => d.kind === 'videoinput');
          setCams(list);
          if (list.length) setCamErr(null);
        }),
      );
  }, [kind, cams]);

  const choose = async (k: 'video' | 'image') => {
    const f = await client.pickFile(k);
    if (f) {
      setPath(f.path);
      if (!name) setName(f.name);
    }
  };

  const draft = (): NewSource | null => {
    const n = name.trim();
    switch (kind) {
      case 'camera':
        return cam ? { name: n || cam.label || 'Camera', kind: { type: 'camera', deviceId: cam.deviceId, label: cam.label } } : null;
      case 'video':
        return path
          ? { name: n || 'Video', kind: { type: 'video', path, durationS: 0, playback: { playing: false, posS: 0, at: 0 } }, looping }
          : null;
      case 'image':
        return path ? { name: n || 'Picture', kind: { type: 'image', path } } : null;
      case 'color':
        return { name: n || 'Colour', kind: { type: 'color', color } };
      case 'pattern':
        return { name: n || 'Test pattern', kind: { type: 'pattern' } };
    }
  };
  const ready = draft();
  const previewSource = ready ? { id: 'draft', volume: 1, muted: true, looping: false, fit: 'contain' as const, ...ready } : null;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Add input"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal__box addinput">
        <header className="modal__head">
          <h2>Add input</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="addinput__body">
          <nav className="addinput__kinds" aria-label="Input type">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                className="addinput__kind"
                aria-pressed={kind === k.kind}
                onClick={() => {
                  setKind(k.kind);
                  setPath(null);
                  setName('');
                }}
              >
                <strong>{k.name}</strong>
                <span>{k.hint}</span>
              </button>
            ))}
          </nav>
          <div className="addinput__setup">
            <div className="addinput__preview">
              {previewSource ? (
                <SourceView source={previewSource} client={client} />
              ) : (
                <span className="addinput__empty">Nothing chosen yet</span>
              )}
            </div>

            {kind === 'camera' && (
              <div className="field">
                <span className="field__label">Choose a camera</span>
                {cams === null && <span className="field__note">Looking for cameras…</span>}
                {camErr && <span className="field__note field__note--warn">{camErr}</span>}
                <div className="addinput__list">
                  {cams?.map((d, i) => (
                    <button
                      key={d.deviceId || i}
                      type="button"
                      className="seg"
                      aria-pressed={cam?.deviceId === d.deviceId}
                      onClick={() => setCam(d)}
                    >
                      {d.label || `Camera ${i + 1}`}
                    </button>
                  ))}
                </div>
                <button type="button" className="linkbtn" onClick={() => setCams(null)}>
                  Look again
                </button>
              </div>
            )}

            {(kind === 'video' || kind === 'image') && (
              <div className="field">
                <span className="field__label">{kind === 'video' ? 'Video file' : 'Picture file'}</span>
                <div className="addinput__file">
                  <button type="button" className="btn" onClick={() => void choose(kind)}>
                    Choose file…
                  </button>
                  <span className="addinput__path" title={path ?? ''}>
                    {path ? path : 'No file chosen'}
                  </span>
                </div>
                {kind === 'video' && (
                  <label className="check">
                    <input type="checkbox" checked={looping} onChange={(e) => setLooping(e.target.checked)} /> Loop at the end (good for
                    background loops)
                  </label>
                )}
              </div>
            )}

            {kind === 'color' && (
              <div className="field">
                <span className="field__label">Colour</span>
                <div className="addinput__swatches">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="swatch"
                      aria-label={c}
                      aria-pressed={color === c}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                  <input type="color" aria-label="Any colour" value={color} onChange={(e) => setColor(e.target.value)} />
                </div>
              </div>
            )}

            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="text"
                value={name}
                maxLength={60}
                placeholder={ready?.name ?? 'Name shown on the tile'}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!ready} onClick={() => ready && onAdd(ready)}>
            Add input
          </button>
        </footer>
      </div>
    </div>
  );
}
