import { Cpu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  refreshEngineInfo,
  setEngineMode,
  setEngineOptions,
  testEngineRecording,
  useEngineInfo,
  type EngineInfo,
  type EngineMode,
  type EngineOptions,
} from '../engine/unified';
import './EngineDialog.css';

const MODES: { mode: EngineMode; label: string; hint: string }[] = [
  {
    mode: 'standard',
    label: 'Standard',
    hint: 'Each screen window draws its own picture and opens its own cameras. Everything works; this is the default.',
  },
  {
    mode: 'unified',
    label: 'Unified (beta)',
    hint: 'One engine opens each camera once, draws every screen once on the graphics card and feeds the windows and the recorder from there.',
  },
];

/**
 * What is built but not yet checked on Windows hardware (docs/ENGINE.md,
 * "What Unified (beta) does not do yet"). Each falls back by itself, and this
 * dialog and the test event say which way was used.
 */
const NOT_YET = [
  'Handing recordings and streams to the graphics card’s encoder without copying them back (zero-copy) is still to be checked on NVIDIA, Intel and AMD cards; when it can’t be used, the picture is copied back as before.',
  'Showing an output through its own display’s graphics card, and choosing the engine’s card, are still to be checked on laptops and computers with two graphics cards.',
  'HDR outputs and HDR cameras and videos are still to be checked on HDR displays and capture cards; outputs stay SDR unless HDR is turned on below.',
];

const OUTPUTS: { id: string; label: string }[] = [
  { id: 'live', label: 'Live Screen' },
  { id: 'back', label: 'Back Screen' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'multiview', label: 'Multiview' },
];

const DEFAULT_OPTIONS: EngineOptions = { adapter: null, ownCard: [], hdr: [], sdrWhite: 203 };

/** The graphics card and how each output window shows (Unified only). */
function EngineOptionsPanel({ info, busy, onError }: { info: EngineInfo; busy: boolean; onError: (m: string | null) => void }) {
  const o = info.options ?? DEFAULT_OPTIONS;
  const cards = info.stats?.cards ?? [];
  const save = (next: EngineOptions) => {
    onError(null);
    setEngineOptions(next).catch((e: unknown) => onError(String(e)));
  };
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  return (
    <>
      <h3 className="eng__title">Graphics card and outputs</h3>
      <label className="field">
        <span className="field__label">Graphics card the engine draws with</span>
        <select value={o.adapter ?? ''} disabled={busy} onChange={(e) => save({ ...o, adapter: e.target.value || null })}>
          <option value="">Automatic (the high-performance card)</option>
          {cards.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name} ({c.kind}, {c.backend})
            </option>
          ))}
        </select>
        <span className="field__note">Changing it starts the engine again on that card (not while recording, streaming or keeping replays).</span>
      </label>
      <div className="eng__outputs" role="group" aria-label="Output windows">
        {OUTPUTS.map((out) => (
          <div key={out.id} className="eng__output">
            <strong>{out.label}</strong>
            {cards.length > 1 && (
              <label>
                <input
                  type="checkbox"
                  checked={o.ownCard.includes(out.id)}
                  disabled={busy}
                  onChange={(e) => save({ ...o, ownCard: toggle(o.ownCard, out.id, e.target.checked) })}
                />{' '}
                Shown by its display’s own graphics card
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={o.hdr.includes(out.id)}
                disabled={busy}
                onChange={(e) => save({ ...o, hdr: toggle(o.hdr, out.id, e.target.checked) })}
              />{' '}
              HDR when its display shows HDR
            </label>
          </div>
        ))}
      </div>
      {o.hdr.length > 0 && (
        <label className="field">
          <span className="field__label">Picture white in HDR outputs (nits)</span>
          <input
            type="number"
            min={80}
            max={1000}
            step={1}
            value={o.sdrWhite}
            disabled={busy}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (v >= 80 && v <= 1000) save({ ...o, sdrWhite: v });
            }}
          />
          <span className="field__note">203 is the usual level; raise it if the picture looks dim on the display.</span>
        </label>
      )}
    </>
  );
}

/** Settings → Engine: Standard or Unified (beta), and how the unified engine is doing. */
export function EngineDialog({ onClose }: { onClose: () => void }) {
  const info = useEngineInfo();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  // Its statistics change every second.
  useEffect(() => {
    const id = setInterval(() => void refreshEngineInfo().catch(() => {}), 1000);
    return () => clearInterval(id);
  }, []);
  const choose = (mode: EngineMode) => {
    setBusy(true);
    setMessage(null);
    setEngineMode(mode)
      .then((i) => i.mode === 'unified' && !i.running && setMessage(i.error ?? 'The unified engine could not start.'))
      .catch((e: unknown) => setMessage(String(e)))
      .finally(() => setBusy(false));
  };
  const record = () => {
    setBusy(true);
    setMessage('Recording 10 seconds of the Live Screen through the engine…');
    testEngineRecording()
      .then(setMessage, (e: unknown) => setMessage(String(e)))
      .finally(() => setBusy(false));
  };
  const s = info?.stats;
  const unified = info?.mode === 'unified';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Engine" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box eng">
        <header className="modal__head">
          <h2>
            <Cpu className="modal__icon" aria-hidden="true" />
            Engine
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="eng__body">
          {!info && <p className="field__note">The engine choice is made in the Lumora app (not the browser demo).</p>}
          <div className="eng__modes" role="radiogroup" aria-label="Engine">
            {MODES.map((m) => (
              <label key={m.mode} className="eng__mode">
                <input type="radio" name="eng-mode" checked={(info?.mode ?? 'standard') === m.mode} disabled={!info || busy} onChange={() => choose(m.mode)} />
                <span>
                  <strong>{m.label}</strong>
                  <span className="field__note">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {unified && (
            <>
              <h3 className="eng__title">How it is doing</h3>
              {info.running && s ? (
                <dl className="eng__stats">
                  <dt>Graphics card</dt>
                  <dd>
                    {s.adapter ? `${s.adapter.name} (${s.adapter.backend}, ${s.adapter.kind})` : '—'}
                    {s.adapter?.choice ? `: ${s.adapter.choice}` : ''}
                  </dd>
                  <dt>Time per frame</dt>
                  <dd>
                    {s.msPerFrame.toFixed(2)} ms (sending pictures {s.uploadMs.toFixed(2)}, drawing {s.renderMs.toFixed(2)}, windows {s.presentMs.toFixed(2)},
                    previews {s.readbackMs.toFixed(2)})
                  </dd>
                  <dt>Late frames</dt>
                  <dd>
                    {s.lateFrames} of {s.frames}
                    {s.recoveries ? ` (the graphics card was reset ${s.recoveries} time${s.recoveries === 1 ? '' : 's'}; the engine carried on)` : ''}
                  </dd>
                  <dt>Graphics</dt>
                  <dd>
                    {s.overlay
                      ? `${s.overlay.framesPerS.toFixed(1)} updates a second (${s.overlay.mbPerS.toFixed(1)} MB/s), ${Math.round(s.overlay.latencyMs)} ms behind, ${s.overlay.planes} shown`
                      : '—'}
                  </dd>
                  {!!s.vision?.inputs && (
                    <>
                      <dt>Person finding</dt>
                      <dd>
                        {s.vision.inputs} input{s.vision.inputs === 1 ? '' : 's'} (background or auto-framing): {s.vision.answers} answers,{' '}
                        {s.vision.masks ? `${s.vision.masks} with a person mask` : 'no person mask yet'}
                      </dd>
                    </>
                  )}
                  <dt>Encoding</dt>
                  <dd>
                    {s.feeds?.length
                      ? s.feeds
                          .map(
                            (f) =>
                              `${f.kind === 'input' ? 'camera file' : f.kind === 'vertical' ? 'vertical' : 'picture'}: ${f.stats?.framesIn ?? 0} frames${f.stats?.framesDropped ? `, ${f.stats.framesDropped} late` : ''}${f.route ? `, ${f.route.path}` : ''}${f.error ? ` (${f.error})` : ''}`,
                          )
                          .join('; ')
                      : 'nothing now'}
                  </dd>
                  <dt>Screens in the engine’s windows</dt>
                  <dd>
                    {s.outputCards?.length
                      ? s.outputCards
                          .map((c) => `${c.output}: ${c.color}, shown by ${c.presentedBy}${c.copied ? ' (copied from the engine’s card)' : ''}`)
                          .join('; ')
                      : s.outputs.length
                        ? s.outputs.join(', ')
                        : info.nativeOutputs
                          ? 'none open (Outputs opens them)'
                          : 'none (Windows only)'}
                  </dd>
                </dl>
              ) : (
                <p className="field__note field__note--warn">{info.error ?? 'Starting…'}</p>
              )}
              {s?.notes.map((n) => (
                <p key={n} className="field__note">
                  {n}
                </p>
              ))}
              {info.nativeOutputs && <EngineOptionsPanel info={info} busy={busy} onError={setMessage} />}
              <h3 className="eng__title">Still to be checked on Windows hardware</h3>
              <ul className="eng__list">
                {NOT_YET.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
          {message && (
            <p className="field__note" role="status">
              {message}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          {unified && info.running && (
            <button type="button" className="btn" disabled={busy} onClick={record}>
              Test the engine’s recording
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
