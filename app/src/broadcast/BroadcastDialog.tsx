import { useEffect, useState } from 'react';
import type { CaptureSettings, Destination, EngineClient, Quality } from '../engine/client';
import { useBroadcast } from './BroadcastContext';
import { QUALITIES, recordingType } from './recorder';
import './broadcast.css';

/** Streaming services with their server address filled in. */
export const SERVICES: { name: string; url: string; keyHelp: string; vertical?: boolean }[] = [
  {
    name: 'YouTube',
    url: 'rtmp://a.rtmp.youtube.com/live2',
    keyHelp: 'YouTube Studio → Go live → Stream → Stream key',
  },
  {
    name: 'Facebook',
    url: 'rtmps://live-api-s.facebook.com:443/rtmp',
    keyHelp: 'Facebook → Live video → Streaming software → Stream key',
  },
  {
    name: 'Vimeo',
    url: 'rtmps://rtmp-global.cloud.vimeo.com:443/live',
    keyHelp: 'Vimeo → Live event → Connect with RTMP → Stream key',
  },
  {
    name: 'YouTube Shorts',
    url: 'rtmp://a.rtmp.youtube.com/live2',
    keyHelp: 'YouTube Studio → Go live → Stream → Stream key (a second stream, for the vertical version)',
    vertical: true,
  },
  {
    name: 'TikTok',
    url: '',
    keyHelp: 'TikTok LIVE Studio or TikTok Live → Streaming software → Server URL and Stream key',
    vertical: true,
  },
  {
    name: 'Instagram',
    url: '',
    keyHelp: 'Instagram → Live → Streaming software → Stream URL and Stream key',
    vertical: true,
  },
  {
    name: 'Other (RTMP)',
    url: '',
    keyHelp: 'The server address and stream key from your streaming service',
  },
];

const BITRATES = [
  { kbps: 3000, name: '3 Mbps — slow internet' },
  { kbps: 4500, name: '4.5 Mbps' },
  { kbps: 6000, name: '6 Mbps — recommended for 1080p' },
  { kbps: 9000, name: '9 Mbps — 1080p60' },
  { kbps: 12000, name: '12 Mbps — 1440p' },
  { kbps: 18000, name: '18 Mbps — 1440p60' },
  { kbps: 25000, name: '25 Mbps — 4K' },
  { kbps: 40000, name: '40 Mbps — 4K, best (recording or very fast internet)' },
];

const AUDIO = [
  { kbps: 128, name: '128 kbps' },
  { kbps: 160, name: '160 kbps — recommended' },
  { kbps: 192, name: '192 kbps' },
  { kbps: 256, name: '256 kbps — music' },
  { kbps: 320, name: '320 kbps — best' },
];

/** Recording folder and quality, and where the stream goes. Changes apply on Done. */
export function BroadcastDialog({ client, onClose }: { client: EngineClient; onClose: () => void }) {
  const b = useBroadcast();
  const [draft, setDraft] = useState<CaptureSettings | null>(b ? structuredClone(b.settings) : null);
  const [folder, setFolder] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void client.captureFolder().then(setFolder, () => {});
  }, [client]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!b || !draft) return null;

  const set = (patch: Partial<CaptureSettings>) => setDraft({ ...draft, ...patch });
  const setDest = (id: string, patch: Partial<Destination>) =>
    set({
      destinations: draft.destinations.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    });
  const add = () => {
    const id = `dest-${Date.now().toString(36)}`;
    const used = new Set(draft.destinations.map((d) => d.name));
    const service = SERVICES.find((s) => !used.has(s.name)) ?? SERVICES[SERVICES.length - 1]!;
    set({
      destinations: [...draft.destinations, { id, name: service.name, url: service.url, key: '', enabled: true, vertical: !!service.vertical }],
    });
  };
  const choose = () =>
    void client.pickFolder().then(
      (f) => {
        if (!f) return;
        set({ folder: f });
        setFolder(f);
      },
      (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)),
    );
  const done = () => void b.saveSettings(draft).then(onClose, (e: unknown) => setProblem(String(e)));
  const canRecord = recordingType() !== null;
  const running = !!(b.status.recording || b.status.streaming);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Recording and streaming"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal__box bcd">
        <header className="modal__head">
          <h2>Recording and streaming</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="bcd__body">
          <p className="bcd__intro">
            REC and GO LIVE (on the bottom bar) record and stream the <strong>Live Screen</strong> with the <strong>Stream</strong> sound mix — exactly what the
            audience sees, even if the Live Screen isn’t shown on any display.
          </p>
          {!canRecord && <p className="field__note field__note--warn">This web view can’t record video. Recording and streaming work in the Windows app.</p>}

          <section className="bcd__section">
            <h3>Recording</h3>
            <label className="field">
              <span className="field__label">Save recordings in</span>
              <span className="bcd__row">
                <input className="text bcd__grow" value={draft.folder ?? folder} readOnly aria-label="Recordings folder" />
                <button type="button" className="btn" onClick={choose}>
                  Choose…
                </button>
              </span>
              <span className="field__note">
                Recordings are saved as they go, so nothing is lost if the computer stops.
                {b.status.ffmpeg
                  ? ' They become .mp4 files when the recording stops.'
                  : ' (Install FFmpeg to get .mp4 files; without it they are .mkv/.webm, which play in VLC and upload to YouTube.)'}
              </span>
            </label>
            <label className="field">
              <span className="field__label">Sound in recordings</span>
              <select
                value={draft.recordMix}
                onChange={(e) =>
                  set({
                    recordMix: e.target.value as CaptureSettings['recordMix'],
                  })
                }
              >
                <option value="stream">The Stream mix (same as the stream)</option>
                <option value="recording">The Recording mix (mix B in the mixer)</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.iso ?? false} onChange={(e) => set({ iso: e.target.checked })} /> Also record each camera to its own file
              (for editing afterwards)
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.chapters ?? true} onChange={(e) => set({ chapters: e.target.checked })} /> Save a chapter list with each
              recording (what was on air when — paste it into the YouTube description)
            </label>
            {b.status.lastRecording && !b.status.lastRecording.startsWith('blob:') && (
              <p className="field__note">
                Last recording: <span className="bcd__path">{b.status.lastRecording}</span>
              </p>
            )}
          </section>

          <section className="bcd__section">
            <h3>Quality</h3>
            <div className="bcd__row">
              <label className="field bcd__grow">
                <span className="field__label">Picture</span>
                <select
                  value={draft.quality}
                  onChange={(e) => {
                    // Each size comes with the bitrate that suits it (change it after if needed).
                    const quality = e.target.value as Quality;
                    set({ quality, videoKbps: QUALITIES[quality].kbps });
                  }}
                >
                  {(Object.keys(QUALITIES) as Quality[]).map((q) => (
                    <option key={q} value={q}>
                      {QUALITIES[q].name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field bcd__grow">
                <span className="field__label">Video bitrate</span>
                <select value={draft.videoKbps} onChange={(e) => set({ videoKbps: Number(e.target.value) })}>
                  {BITRATES.map((r) => (
                    <option key={r.kbps} value={r.kbps}>
                      {r.name}
                    </option>
                  ))}
                  {!BITRATES.some((r) => r.kbps === draft.videoKbps) && <option value={draft.videoKbps}>{draft.videoKbps / 1000} Mbps</option>}
                </select>
              </label>
              <label className="field bcd__grow">
                <span className="field__label">Sound bitrate</span>
                <select value={draft.audioKbps ?? 160} onChange={(e) => set({ audioKbps: Number(e.target.value) })}>
                  {AUDIO.map((r) => (
                    <option key={r.kbps} value={r.kbps}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {running && <p className="field__note">Quality changes apply the next time recording or streaming starts.</p>}
          </section>

          <section className="bcd__section">
            <h3>Stream to</h3>
            {!b.status.ffmpeg && (
              <p className="field__note field__note--warn">
                Streaming needs FFmpeg, which wasn’t found. The Windows app comes with it; for now, install FFmpeg and start Lumora again.
              </p>
            )}
            {draft.destinations.length === 0 && (
              <p className="field__note">Nowhere yet. Add YouTube, Facebook or another service; you can stream to several at once.</p>
            )}
            {draft.destinations.map((d) => {
              const service = SERVICES.find((s) => s.name === d.name) ?? SERVICES.find((s) => s.url && s.url === d.url) ?? SERVICES[SERVICES.length - 1]!;
              return (
                <div key={d.id} className={`bcd__dest${d.enabled ? '' : ' is-off'}`}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) => setDest(d.id, { enabled: e.target.checked })}
                      aria-label={`Stream to ${d.name}`}
                    />
                  </label>
                  <div className="bcd__destbody">
                    <div className="bcd__row">
                      <input className="text" value={d.name} maxLength={40} onChange={(e) => setDest(d.id, { name: e.target.value })} aria-label="Name" />
                      <select
                        aria-label="Service"
                        value={service.name}
                        onChange={(e) => {
                          const s = SERVICES.find((x) => x.name === e.target.value)!;
                          setDest(d.id, {
                            url: s.url,
                            name: SERVICES.some((x) => x.name === d.name) ? s.name : d.name,
                            vertical: !!s.vertical,
                          });
                        }}
                      >
                        {SERVICES.map((s) => (
                          <option key={s.name}>{s.name}</option>
                        ))}
                      </select>
                      <span className="bcd__grow" />
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          set({
                            destinations: draft.destinations.filter((x) => x.id !== d.id),
                          })
                        }
                        aria-label={`Remove ${d.name}`}
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      className="text"
                      value={d.url}
                      placeholder="rtmp://server/app"
                      onChange={(e) => setDest(d.id, { url: e.target.value })}
                      aria-label="Server address"
                    />
                    <span className="bcd__row">
                      <input
                        className="text bcd__grow"
                        type={shown === d.id ? 'text' : 'password'}
                        value={d.key}
                        placeholder="Stream key"
                        autoComplete="off"
                        onChange={(e) => setDest(d.id, { key: e.target.value })}
                        aria-label="Stream key"
                      />
                      <button type="button" className="btn" onClick={() => setShown(shown === d.id ? null : d.id)}>
                        {shown === d.id ? 'Hide' : 'Show'}
                      </button>
                    </span>
                    <span className="field__note">Stream key: {service.keyHelp}. It stays on this computer.</span>
                    {draft.quality !== 'vertical' && (
                      <label className="check">
                        <input type="checkbox" checked={!!d.vertical} onChange={(e) => setDest(d.id, { vertical: e.target.checked })} /> Send the vertical
                        version (9:16, for TikTok, Reels and Shorts): the whole picture, nothing cut off, at the same time as the wide stream
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
            <button type="button" className="btn" onClick={add}>
              + Add a destination
            </button>
          </section>
          {problem && (
            <p className="field__note field__note--warn" role="alert">
              {problem}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
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
