import { Video, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { StreamView } from '../components/BrowserView';
import { cleanStreamUrl } from '../engine/stream';
import type { Act } from './act';

/** A stream input: its address, buffer, and whether it is coming in. */
export function StreamCard({ source, act, client, onClose }: { show: Show; source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const st = source.kind.type === 'stream' ? source.kind : null;
  const [url, setUrl] = useState(st?.url ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const status = useStreamStatus(client)[source.id];
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!st) return null;
  const save = (p: { url?: string; bufferMs?: number }) => {
    const next = { url: p.url ?? st.url, bufferMs: p.bufferMs ?? st.bufferMs };
    act({ type: 'updateStream', id: source.id, stream: next });
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Stream" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box brc">
        <header className="modal__head">
          <h2>
            <Video className="modal__icon" aria-hidden="true" />
            Stream — {source.name}
          </h2>
          <span className="remote__spacer" />
          <span className={`brc__air${status?.live ? '' : ' brc__air--off'}`}>{status?.live ? 'CONNECTED' : 'NOT CONNECTED'}</span>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="brc__body">
          <section className="brc__main">
            <form
              className="brc__bar"
              onSubmit={(e) => {
                e.preventDefault();
                const clean = cleanStreamUrl(url);
                if (!clean) return setProblem('That isn’t a stream address (srt://, rtmp://, rtsp://, https://…).');
                setProblem(null);
                save({ url: clean });
              }}
            >
              <input className="text brc__url" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Stream address" spellCheck={false} />
              <button type="submit" className="btn btn--primary">
                Connect
              </button>
            </form>
            <div className="brc__stage" style={{ aspectRatio: '16 / 9' }}>
              <StreamView id={source.id} client={client} fit="contain" />
            </div>
            {(problem ?? status?.problem) && (
              <p className="field__note field__note--warn" role="alert">
                {problem ?? status?.problem}
              </p>
            )}
          </section>
          <section className="brc__side">
            <span className="brc__label">Buffer</span>
            <select value={st.bufferMs} onChange={(e) => save({ bufferMs: Number(e.target.value) })} aria-label="Buffer">
              <option value={0}>None — as fast as possible</option>
              <option value={500}>Half a second (usual)</option>
              <option value={2000}>2 seconds — shaky internet</option>
              <option value={5000}>5 seconds — very shaky internet</option>
            </select>
            <span className="field__note">A buffer rides out a shaky connection, at the cost of a little delay.</span>
            <span className="brc__label">Addresses that work</span>
            <span className="field__note">
              srt://computer:9000 · rtmp://server/live/key · rtsp://camera/stream1 (IP cameras; add name:password@ if needed) · https://…/playlist.m3u8 (HLS) ·
              udp://@:1234
            </span>
            <span className="field__note">If it drops, Lumora keeps trying to reconnect by itself.</span>
          </section>
        </div>
      </div>
    </div>
  );
}

/** How every stream input is doing, checked every two seconds. */
export function useStreamStatus(client: EngineClient) {
  const [status, setStatus] = useState<Record<string, { live: boolean; problem: string | null }>>({});
  useEffect(() => {
    let alive = true;
    const check = () =>
      void client.streamStatus().then(
        (s) => alive && setStatus(s),
        () => undefined,
      );
    check();
    const id = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [client]);
  return status;
}
