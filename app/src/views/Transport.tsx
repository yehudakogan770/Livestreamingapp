import type { Source } from '../engine/types/Source';
import { clock, sourcePosition } from '../engine/timing';
import { useNow } from '../engine/useNow';
import type { Act } from './act';

/** Play / pause / skip and time for the video under a monitor. Empty for other sources. */
export function Transport({ source, act }: { source: Source | undefined; act: Act; label?: string }) {
  const now = useNow(false, 250);
  if (!source || source.kind.type !== 'video') {
    return (
      <div className="transport transport--empty">
        {/* Its name is already above the picture: nothing to repeat here. */}
        <span className="transport__what" aria-hidden />
      </div>
    );
  }
  const { durationS, playback } = source.kind;
  const pos = sourcePosition(source, now);
  const seek = (s: number) => act({ type: 'seek', id: source.id, posS: Math.max(0, durationS > 0 ? Math.min(durationS, s) : s) });
  return (
    <div className="transport">
      <button type="button" className="icon" aria-label="Back to start" onClick={() => seek(0)}>
        ⏮
      </button>
      <button type="button" className="icon" aria-label="Back 10 seconds" onClick={() => seek(pos - 10)}>
        −10
      </button>
      <button
        type="button"
        className={`icon icon--play${playback.playing ? ' is-on' : ''}`}
        aria-label={playback.playing ? 'Pause' : 'Play'}
        onClick={() => act({ type: playback.playing ? 'pause' : 'play', id: source.id })}
      >
        {playback.playing ? '❚❚' : '▶'}
      </button>
      <button type="button" className="icon" aria-label="Forward 10 seconds" onClick={() => seek(pos + 10)}>
        +10
      </button>
      <input
        className="transport__scrub"
        type="range"
        min={0}
        max={Math.max(1, durationS)}
        step={0.1}
        value={Math.min(pos, Math.max(1, durationS))}
        aria-label="Position"
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="transport__time">
        {clock(pos)} / {durationS > 0 ? clock(durationS) : '–:––'}
        {durationS > 0 && <em> −{clock(durationS - pos)}</em>}
      </span>
      <button
        type="button"
        className={`chip${source.looping ? ' is-on' : ''}`}
        aria-pressed={source.looping}
        onClick={() => act({ type: 'updateSource', id: source.id, patch: { looping: !source.looping } })}
      >
        Loop
      </button>
    </div>
  );
}
