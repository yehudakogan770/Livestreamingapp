import { Captions as CaptionsIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Captions } from '../engine/types/Captions';
import type { Show } from '../engine/types/Show';
import { useBroadcast } from '../broadcast/BroadcastContext';
import '../broadcast/broadcast.css';
import './captions.css';
import { LANGUAGES } from './whisper';

/** Languages the operator is most likely to want, first. */
const FIRST = ['he', 'es', 'yi', 'ru', 'fr', 'ar', 'de', 'pt', 'it', 'zh', 'hi', 'uk', 'pl'];

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Live captions: what's said, written for the stream's viewers (never on the room's screens). */
export function CaptionsDialog({
  show,
  client,
  onClose,
  onStreamSettings,
}: {
  show: Show;
  client: EngineClient;
  onClose: () => void;
  onStreamSettings: () => void;
}) {
  const b = useBroadcast();
  const c = show.captions;
  const set = (p: Partial<Captions>) => void client.dispatch({ type: 'setCaptions', captions: { ...c, ...p } });
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const id = setInterval(() => setLines(b?.captions.lines() ?? []), 300);
    return () => clearInterval(id);
  }, [b]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const mics = show.sources.filter((s) => s.kind.type === 'microphone');
  const youtube = (b?.settings.destinations ?? []).filter((d) => d.enabled && (d.captionsUrl ?? '').trim());
  const st = b?.captions.state ?? { state: 'off' as const };
  const stateText =
    st.state === 'downloading'
      ? `Getting the speech model ready (the first time, a one-time download of about ${c.language === 'en' ? '30' : c.best ? '250' : '80'} MB)…`
      : st.state === 'starting'
        ? 'Starting…'
        : st.state === 'listening'
          ? 'Listening.'
          : st.state === 'failed'
            ? `Stopped: ${st.message}`
            : 'Off.';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Live captions" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box cap">
        <header className="modal__head">
          <h2>
            <CaptionsIcon className="modal__icon" aria-hidden="true" />
            Live captions
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="cap__body">
          <label className="check cap__main">
            <input type="checkbox" checked={c.on} onChange={(e) => set({ on: e.target.checked })} /> Write what is said for the stream’s viewers
          </label>
          <p className="field__note">
            Only for the stream (YouTube and other sites): never on the screens in the room, and never in the recording. The words are worked out on this
            computer, without internet.
          </p>
          <div className={`cap__state is-${st.state}`} role="status">
            {stateText}
          </div>
          <div className="cap__preview" aria-label="The words right now">
            {lines.length ? (
              lines.map((l, i) => (
                <div key={i} dir="auto">
                  {l}
                </div>
              ))
            ) : (
              <span>{c.on ? 'Words appear here as people speak.' : ' '}</span>
            )}
          </div>
          <div className="cap__row">
            <label className="field cap__grow">
              <span className="field__label">Language spoken</span>
              <select value={c.language} onChange={(e) => set({ language: e.target.value })}>
                <option value="en">English</option>
                <option value="auto">Work it out by itself (any language)</option>
                <optgroup label="Other languages">
                  {[...FIRST, ...LANGUAGES.filter((l) => l !== 'en' && !FIRST.includes(l)).sort((a, b) => languageName(a).localeCompare(languageName(b)))].map(
                    (l) => (
                      <option key={l} value={l}>
                        {languageName(l)}
                      </option>
                    ),
                  )}
                </optgroup>
              </select>
            </label>
            {c.language !== 'en' && (
              <label className="field">
                <span className="field__label">Model</span>
                <select value={c.best ? 'best' : 'standard'} onChange={(e) => set({ best: e.target.value === 'best' })}>
                  <option value="standard">Standard (quicker)</option>
                  <option value="best">Most accurate (needs a fast computer)</option>
                </select>
              </label>
            )}
          </div>
          {c.language !== 'en' && (
            <p className="field__note">Other languages come phrase by phrase, a moment after they are said. Accuracy is best for widely spoken languages.</p>
          )}
          <label className="field">
            <span className="field__label">Listen to</span>
            <select value={c.listen ?? ''} onChange={(e) => set({ listen: e.target.value || null })}>
              <option value="">Everything in the Stream mix</option>
              {mics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <span className="field__note">A speaker’s own microphone gives the best captions (music and noise stay out).</span>
          </label>

          <h3 className="cap__h">Viewers turn them on and off (CC)</h3>
          <p className="field__note">
            {youtube.length
              ? `Sent as closed captions to ${youtube.map((d) => d.name).join(', ')} while streaming.`
              : 'For YouTube: paste the captions address from YouTube Studio into your YouTube destination.'}{' '}
            <button type="button" className="linkish" onClick={onStreamSettings}>
              Recording and streaming settings…
            </button>
          </p>

          <h3 className="cap__h">In the stream picture</h3>
          <label className="check">
            <input type="checkbox" checked={c.inPicture} onChange={(e) => set({ inPicture: e.target.checked })} /> Also write them in the stream picture (for
            sites without closed captions; everyone sees them)
          </label>
          {c.inPicture && (
            <div className="cap__row">
              <label className="field">
                <span className="field__label">Where</span>
                <select value={c.place} onChange={(e) => set({ place: e.target.value as Captions['place'] })}>
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Lines</span>
                <select value={c.lines} onChange={(e) => set({ lines: Number(e.target.value) })}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <label className="field cap__grow">
                <span className="field__label">Size</span>
                <input type="range" min={60} max={160} value={Math.round(c.size * 100)} onChange={(e) => set({ size: Number(e.target.value) / 100 })} />
              </label>
            </div>
          )}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
