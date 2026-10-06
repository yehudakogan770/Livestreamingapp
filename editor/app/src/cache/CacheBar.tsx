// The render cache's line over the timeline ruler.
import { useSyncExternalStore } from 'react';
import type { Project, Sequence } from '../model/types';
import { renderCache } from './manager';
import './cache.css';

let tick = 0;
const subscribe = (f: () => void) =>
  renderCache.subscribe(() => {
    tick++;
    f();
  });

/** Red: heavy and not cached yet; blue: cached; striped: being made now. */
export function CacheBar({ p, s, zoom, from, width }: { p: Project; s: Sequence; zoom: number; from: number; width: number }) {
  useSyncExternalStore(subscribe, () => tick);
  const runs = renderCache.coverage(p, s);
  const making = renderCache.progress;
  if (!runs.length && !making) return null;
  // Only what is on screen is drawn.
  const lo = from / zoom;
  const hi = (from + width) / zoom;
  return (
    <div className="rcache" aria-hidden="true">
      {runs
        .filter((r) => r.to >= lo && r.from <= hi)
        .map((r) => (
          <i
            key={`${r.state}${r.from}`}
            className={`rcache__run rcache__run--${r.state}`}
            style={{ left: r.from * zoom, width: Math.max(1, (r.to - r.from) * zoom) }}
          />
        ))}
      {making && (
        <i
          className="rcache__run rcache__run--making"
          style={{ left: making.from * zoom, width: Math.max(1, (making.to - making.from) * making.done * zoom) }}
        />
      )}
    </div>
  );
}
