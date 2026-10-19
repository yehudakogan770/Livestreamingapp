@@@
import { refreshEngineInfo, setEngineMode, testEngineRecording, useEngineInfo, type EngineMode } from '../engine/unified';
===
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
@@@
/** What Unified (beta) does not do yet (docs/ENGINE.md, "What Unified (beta) does not do yet"). */
const NOT_YET = [
  'In the multiview, a graphics input’s tile shows it only while it is on air on the Live Screen.',
  'A camera or video used as a slide comes up without the slides’ fade (a camera behind slides or Pesukim words is shown).',
  'The vertical version has no drop shadow under the picture.',
  'Recordings and streams are copied back from the graphics card before the hardware encoder takes them (not handed over directly yet); every screen is drawn by one graphics card, and HDR displays get the standard picture.',
];
===
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
              <input type="checkbox" checked={o.hdr.includes(out.id)} disabled={busy} onChange={(e) => save({ ...o, hdr: toggle(o.hdr, out.id, e.target.checked) })} />{' '}
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
@@@
                  <dt>Graphics card</dt>
                  <dd>{s.adapter ? `${s.adapter.name} (${s.adapter.backend}, ${s.adapter.kind})` : '—'}</dd>
===
                  <dt>Graphics card</dt>
                  <dd>
                    {s.adapter ? `${s.adapter.name} (${s.adapter.backend}, ${s.adapter.kind})` : '—'}
                    {s.adapter?.choice ? `: ${s.adapter.choice}` : ''}
                  </dd>
@@@
                              `${f.kind === 'input' ? 'camera file' : f.kind === 'vertical' ? 'vertical' : 'picture'}: ${f.stats?.framesIn ?? 0} frames${f.stats?.framesDropped ? `, ${f.stats.framesDropped} late` : ''}${f.error ? ` (${f.error})` : ''}`,
===
                              `${f.kind === 'input' ? 'camera file' : f.kind === 'vertical' ? 'vertical' : 'picture'}: ${f.stats?.framesIn ?? 0} frames${f.stats?.framesDropped ? `, ${f.stats.framesDropped} late` : ''}${f.route ? `, ${f.route.path}` : ''}${f.error ? ` (${f.error})` : ''}`,
@@@
                  <dt>Screens in the engine’s windows</dt>
                  <dd>{s.outputs.length ? s.outputs.join(', ') : info.nativeOutputs ? 'none open (Outputs opens them)' : 'none (Windows only)'}</dd>
===
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
@@@
              <h3 className="eng__title">Not in Unified (beta) yet</h3>
===
              {info.nativeOutputs && <EngineOptionsPanel info={info} busy={busy} onError={setMessage} />}
              <h3 className="eng__title">Still to be checked on Windows hardware</h3>
