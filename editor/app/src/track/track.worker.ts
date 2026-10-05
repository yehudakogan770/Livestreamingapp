// Tracking off the main thread, so the editor stays smooth: frames come in
// one by one (small, gray) and the tracker says where the thing is now.
import { gray } from './math';
import { createTracker, type TrackerMessage } from './protocol';

const ctx = self as unknown as { onmessage: ((e: MessageEvent<TrackerMessage>) => void) | null; postMessage: (m: unknown) => void };
let tracker: ReturnType<typeof createTracker> | null = null;

ctx.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'start') {
      tracker = createTracker(m, gray(m.w, m.h, m.data));
      ctx.postMessage({ type: 'ready' });
    } else if (tracker) ctx.postMessage({ type: 'pose', pose: tracker.next(m, gray(m.w, m.h, m.data)) });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
