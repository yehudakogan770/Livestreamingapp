import { Pause, Play, Repeat, RotateCcw, RotateCw, SkipBack } from 'lucide-react';
import type { Source } from '../engine/types/Source';
import { clock, sourcePosition } from '../engine/timing';
import { useNow } from '../engine/useNow';
import type { Act } from './act';

/** Play / pause / skip and time for the video under a monitor. Empty for other sources. */
export function Transport({ source, act }: { source: Source | undefined; act: Act; label?: string }) {
  if (!source || source.kind.type !== 'video') {
    return (
      <div className="transport transport--empty">
        {/* Its name is already above the picture: nothing to repeat here. */}
        <span className="transport__what" aria-hidden />
      </div>
    );
  }
  return <VideoTransport source={source} kind={source.kind} act={act} />;
}

/** The clock ticks only while a video is there (a camera's empty strip never re-renders). */
function VideoTransport({ source, kind, act }: { source: Source; kind: Extract<Source['kind'], { type: 'video' }>; act: Act }) {
  const now = useNow(false, 250);
  const { durationS, playback } = kind;
  const pos = sourcePosition(source, now);
  const seek = (s: number) => act({ type: 'seek', id: source.id, posS: Math.max(0, durationS > 0 ? Math.min(durationS, s) : s) });
  return (
    <div className="transport">
      <button type="button" className="icon" aria-label="Back to start" title="Back to start" onClick={() => seek(0)}>
        <SkipBack aria-hidden="true" />
      </button>
      <button type="button" className="icon" aria-label="Back 10 seconds" title="Back 10 seconds" onClick={() => seek(pos - 10)}>
        <RotateCcw aria-hidden="true" />
        <small>10</small>
      </button>
      <button
        type="button"
        className={`icon icon--play${playback.playing ? ' is-on' : ''}`}
        aria-label={playback.playing ? 'Pause' : 'Play'}
        title={playback.playing ? 'Pause' : 'Play'}
        onClick={() => act({ type: playback.playing ? 'pause' : 'play', id: source.id })}
      >
        {playback.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <button type="button" className="icon" aria-label="Forward 10 seconds" title="Forward 10 seconds" onClick={() => seek(pos + 10)}>
        <RotateCw aria-hidden="true" />
        <small>10</small>
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
        title="Play it again and again"
        onClick={() => act({ type: 'updateSource', id: source.id, patch: { looping: !source.looping } })}
      >
        <Repeat aria-hidden="true" />
        Loop
      </button>
    </div>
  );
}
