import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Show } from '../engine/types/Show';
import { useBroadcast } from '../broadcast/BroadcastContext';
import { useNow } from '../engine/useNow';
import { clockTime, countdownText, hasPlace, zmanimOn } from '../engine/zmanim';
import './ShabbosGuard.css';

/** How long before the stop the warning shows, ms. */
const WARN_MS = 10 * 60_000;

/**
 * Before Shabbos and Yom Tov: a warning, then the live stream and the
 * recording end by themselves (when the operator asked for that in Event →
 * Zmanim and Shabbos). It stops them once for each candle lighting; starting
 * again afterwards is the operator's own choice.
 */
export function ShabbosGuard({ show }: { show: Show }) {
  const b = useBroadcast();
  const place = show.event.place;
  const on = hasPlace(place) && place.stopBefore;
  const now = useNow(false, 1000);
  const stopped = useRef<number | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const candles = on ? zmanimOn(now, place).candles : null;
  const stopAt = candles === null ? null : candles - place.stopMinutes * 60_000;
  const live = !!b && (!!b.status.streaming || !!b.status.recording);
  // A stream that dropped a moment ago is still wanted: Lumora would bring it back.
  const wanted = live || !!b?.reconnecting;
  useEffect(() => {
    if (!b || stopAt === null || candles === null || now < stopAt || now > candles + 6 * 3_600_000) return;
    if (stopped.current === candles) return;
    stopped.current = candles;
    // Both are stopped (not only what runs this second), so nothing starts again by itself.
    void Promise.allSettled([b.stop('stream'), b.stop('record')]).then(() => wanted && setDone(candles));
  }, [b, now, stopAt, candles, wanted]);
  if (stopAt === null || candles === null) return null;
  if (done === candles && now - candles < 30 * 60_000) {
    return (
      <div className="shabbos shabbos--done" role="status">
        The stream and recording were ended for candle lighting ({clockTime(candles)}). Good Shabbos!
        <button type="button" className="icon" aria-label="Close" onClick={() => setDone(null)}>
          <X aria-hidden="true" />
        </button>
      </div>
    );
  }
  if (!live || now < stopAt - WARN_MS || now >= stopAt) return null;
  return (
    <div className="shabbos" role="alert">
      Candle lighting {clockTime(candles)} — the stream and recording end by themselves in <b>{countdownText(stopAt - now)}</b>
    </div>
  );
}
