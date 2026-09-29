import { useEffect, useState } from 'react';
import type { CaptureChoice, EngineClient } from '../engine/client';
import type { ScreenCapture } from '../engine/types/ScreenCapture';
import './CapturePicker.css';

/** The ScreenCapture a choice stands for. */
export const captureOf = (c: CaptureChoice, cursor: boolean): ScreenCapture => ({
  target: c.kind === 'display' ? { type: 'display', index: c.index, name: c.name } : { type: 'window', title: c.name },
  cursor,
});

/** Is this choice the one a capture shows? */
export const isChosen = (c: CaptureChoice, cap: ScreenCapture | null) =>
  !!cap && (cap.target.type === 'display' ? c.kind === 'display' && c.index === cap.target.index : c.kind === 'window' && c.name === cap.target.title);

/** Pick a display or window to capture (listed fresh from this computer). */
export function CapturePicker({ client, value, onChange }: { client: EngineClient; value: ScreenCapture | null; onChange: (c: ScreenCapture) => void }) {
  const [choices, setChoices] = useState<CaptureChoice[] | null>(null);
  const load = () => {
    setChoices(null);
    void client.captureChoices().then(setChoices);
  };
  useEffect(load, [client]); // eslint-disable-line react-hooks/exhaustive-deps
  const cursor = value?.cursor ?? false;
  if (choices === null) return <p className="field__note">Looking for displays and windows…</p>;
  if (choices.length === 0) return <p className="field__note field__note--warn">Screen capture works in the Windows app.</p>;
  const group = (kind: 'display' | 'window', title: string) => (
    <>
      <span className="field__label">{title}</span>
      <div className="cap__list">
        {choices
          .filter((c) => c.kind === kind)
          .map((c) => (
            <button
              key={`${c.kind}:${c.index}:${c.name}`}
              type="button"
              className="seg cap__item"
              aria-pressed={isChosen(c, value)}
              title={c.app}
              onClick={() => onChange(captureOf(c, cursor))}
            >
              {kind === 'display' ? '🖥 ' : '▭ '}
              {c.name}
              {c.app && kind === 'window' && <small> · {c.app.replace(/\.exe$/i, '')}</small>}
            </button>
          ))}
      </div>
    </>
  );
  return (
    <div className="cap">
      {group('display', 'Whole display')}
      {group('window', 'One window (follows it when it moves)')}
      <div className="cap__row">
        <label className="check">
          <input type="checkbox" checked={cursor} disabled={!value} onChange={(e) => value && onChange({ ...value, cursor: e.target.checked })} /> Show the
          mouse pointer
        </label>
        <button type="button" className="btn btn--small" onClick={load}>
          ↻ Refresh the list
        </button>
      </div>
    </div>
  );
}
