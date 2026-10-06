// The viewer's playback lights: dropped frames, and playing from proxies.
import { useEffect, useState } from 'react';
import type { Engine, PlaybackStats } from '../player/engine';
import type { Ui } from './state';

/** How playback is keeping up, from the counts: idle (nothing played yet), ok, warn or bad. */
export function dropLevel(s: Pick<PlaybackStats, 'drawn' | 'dropped' | 'late'>): 'idle' | 'ok' | 'warn' | 'bad' {
  if (s.drawn < 10) return 'idle';
  const r = (s.dropped + s.late) / (s.drawn + s.dropped);
  return r < 0.01 ? 'ok' : r < 0.05 ? 'warn' : 'bad';
}

/** A light that shows dropped frames while playing (click to count again). */
export function DroppedFrames({ engine }: { engine: Engine }) {
  const [s, setS] = useState<PlaybackStats>({ ...engine.stats });
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = engine.stats;
      setS((was) =>
        was.dropped === now.dropped && was.late === now.late && was.drawn === now.drawn && Math.abs(was.composeMs - now.composeMs) < 0.2 ? was : { ...now },
      );
    }, 500);
    return () => window.clearInterval(id);
  }, [engine]);
  const level = dropLevel(s);
  const title =
    `Dropped frames: ${s.dropped} · late pictures: ${s.late} · drawn: ${s.drawn} · ${s.composeMs.toFixed(1)} ms per frame` +
    (level === 'bad' || level === 'warn' ? '\nTry proxies, or a lower playback quality.' : '') +
    '\nClick to count again.';
  return (
    <button type="button" className={`vmon__drops vmon__drops--${level}`} title={title} aria-label="Dropped frames" onClick={() => engine.resetStats()}>
      <span className="vmon__dot" />
      {s.dropped + s.late > 0 ? s.dropped + s.late : ''}
    </button>
  );
}

/** Play from proxies (on/off). */
export function ProxyToggle({ ui, on }: { ui: Ui; on: boolean }) {
  return (
    <button
      type="button"
      className={`tbtn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      title="Use proxies for playback: heavy files (4K, HEVC, high bit rates) play from lighter copies made in the background. The film is always made from the originals."
      onClick={() => ui.set({ proxies: !on })}
    >
      Proxy
    </button>
  );
}
