// The viewer's native playback light (beta): click to turn it on or off.
import { useSyncExternalStore } from 'react';
import { nativePlayback, type NativePlayback } from '../render/native/client';

/** The light's look and words for the engine's state. */
export function nativeLight(n: Pick<NativePlayback, 'enabled' | 'status' | 'message'>): { level: 'idle' | 'ok' | 'warn' | 'bad'; title: string } {
  if (!n.enabled) return { level: 'idle', title: 'Native playback (beta) is off: the viewer is drawn with WebGL. Click to try the GPU engine.' };
  if (n.status === 'on') return { level: 'ok', title: `Native playback (beta) is on: ${n.message}. Click to go back to WebGL.` };
  if (n.status === 'failed' || n.status === 'unavailable')
    return { level: 'bad', title: `Native playback couldn't start, so the viewer uses WebGL: ${n.message}. Click to turn it off.` };
  return { level: 'warn', title: 'Native playback is starting…' };
}

export function NativeBadge() {
  useSyncExternalStore(nativePlayback.subscribe, nativePlayback.snapshot);
  const { level, title } = nativeLight(nativePlayback);
  return (
    <button
      type="button"
      className={`vmon__drops vmon__drops--${level}`}
      aria-pressed={nativePlayback.enabled}
      aria-label="Native playback (beta)"
      title={title}
      onClick={() => nativePlayback.setEnabled(!nativePlayback.enabled)}
    >
      <span className="vmon__dot" />
      GPU
    </button>
  );
}
