import { Cpu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EngineClient, PerfStats } from '../engine/client';
import { useBroadcast } from './BroadcastContext';

interface Sample {
  perf: PerfStats | null;
  /** This window's own frame rate. */
  uiFps: number;
  frames: { fps: number; target: number; dropped: number } | null;
  /** Recording and stream data rates, Mbit/s. */
  recMbps: number | null;
  streamMbps: number | null;
}

/**
 * How hard the computer is working, always in view (like OBS's stats): the
 * processor, and the frame rate of the picture being recorded or streamed.
 * Click for more.
 */
export function PerfChip({ client }: { client: EngineClient }) {
  const b = useBroadcast();
  const [s, setS] = useState<Sample | null>(null);
  const [open, setOpen] = useState(false);
  const bytes = useRef<{ rec: number; stream: number; at: number } | null>(null);
  const frames = useRef(0);
  const statusRef = useRef(b?.status);
  statusRef.current = b?.status;
  const statsRef = useRef(b?.frameStats);
  statsRef.current = b?.frameStats;

  useEffect(() => {
    let raf = requestAnimationFrame(function tick() {
      frames.current++;
      raf = requestAnimationFrame(tick);
    });
    const id = setInterval(() => {
      void client.perfStats().then((perf) => {
        const st = statusRef.current;
        const now = performance.now();
        const rec = st?.recording?.bytes ?? 0;
        const stream = st?.streaming?.bytes ?? 0;
        const prev = bytes.current;
        const secs = prev ? (now - prev.at) / 1000 : 0;
        const rate = (b: number, a: number | undefined, on: boolean) => (on && prev && secs > 0 && a !== undefined ? ((b - a) * 8) / secs / 1e6 : null);
        setS({
          perf,
          uiFps: frames.current,
          frames: statsRef.current?.() ?? null,
          recMbps: rate(rec, prev?.rec, !!st?.recording),
          streamMbps: rate(stream, prev?.stream, !!st?.streaming),
        });
        bytes.current = { rec, stream, at: now };
        frames.current = 0;
      });
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [client]);

  if (!s) return null;
  const cpu = s.perf ? Math.round(s.perf.cpu) : null;
  const fr = s.frames;
  const gpu = s.perf?.gpu != null ? Math.round(s.perf.gpu) : null;
  const busy = (cpu !== null && cpu > 85) || (gpu !== null && gpu > 90) || (fr !== null && fr.fps < fr.target * 0.85);
  const label = [cpu !== null ? `CPU ${cpu}%` : null, fr ? `${fr.fps} fps` : null].filter(Boolean).join(' · ') || `${s.uiFps} fps`;
  const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
  return (
    <span className="perf">
      <button
        type="button"
        className={`btn bc-btn perf__chip${busy ? ' perf__chip--busy' : ''}`}
        aria-expanded={open}
        title="How hard the computer is working — click for more"
        onClick={() => setOpen(!open)}
      >
        <Cpu aria-hidden="true" />
        {label}
      </button>
      {open && (
        <div className="perf__panel" role="dialog" aria-label="Performance">
          <table>
            <tbody>
              {s.perf && (
                <>
                  <tr>
                    <th>Processor</th>
                    <td>{cpu}%</td>
                  </tr>
                  {gpu !== null && (
                    <tr>
                      <th>Graphics card</th>
                      <td>{gpu}%</td>
                    </tr>
                  )}
                  <tr>
                    <th>Memory</th>
                    <td>
                      {mb(s.perf.memUsedMb)} of {mb(s.perf.memTotalMb)} (Lumora {mb(s.perf.appMemMb)})
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <th>Control window</th>
                <td>{s.uiFps} frames a second</td>
              </tr>
              <tr>
                <th>Recording picture</th>
                <td>{fr ? `${fr.fps} of ${fr.target} frames a second · ${fr.dropped} dropped` : 'not drawing (starts with REC, GO LIVE or REPLAY)'}</td>
              </tr>
              {s.recMbps !== null && (
                <tr>
                  <th>Recording</th>
                  <td>{s.recMbps.toFixed(1)} Mbit/s to the disk</td>
                </tr>
              )}
              {s.streamMbps !== null && (
                <tr>
                  <th>Stream</th>
                  <td>
                    {s.streamMbps.toFixed(1)} Mbit/s
                    {b?.status.streaming?.speed != null && ` · keeping up at ${Math.round(b.status.streaming.speed * 100)}%`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {busy && (
            <p className="field__note field__note--warn">
              The computer is struggling: close other programs, choose a lower quality (Settings → Recording and streaming), or use fewer web page and screen
              capture inputs.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
