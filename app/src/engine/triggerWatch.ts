// The triggers the engine can't see for itself, watched by the control window:
// a sound level held for a while, and the recording or the stream starting or
// stopping. When one goes off, the window runs it with `fireTrigger`.

import { useEffect, useRef } from 'react';
import type { EngineClient } from './client';
import type { Show } from './types/Show';
import type { Trigger } from './types/Trigger';
import { useSound } from '../audio/SoundContext';

/** A sound trigger fires again only after the sound has gone the other way this long. */
export const REARM_MS = 2000;

export interface BroadcastNow {
  recording: boolean;
  streaming: boolean;
}

const toDb = (level: number) => (level > 0 ? 20 * Math.log10(level) : -Infinity);

interface SoundState {
  /** Since when the condition has held (null: it doesn't now). */
  since: number | null;
  /** Since when it has not held (null: it does now). */
  offSince: number | null;
  /** Went off, and not re-armed yet. */
  fired: boolean;
}

/** Decides which watched triggers go off. Pure: feed it levels, status and the time. */
export class TriggerWatch {
  private sound = new Map<string, SoundState>();
  private last: BroadcastNow | null = null;

  /**
   * The ids of triggers to run now.
   * @param levels latest peak level (0–1) per input id
   */
  feed(triggers: readonly Trigger[], levels: ReadonlyMap<string, number>, broadcast: BroadcastNow, now: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of triggers) {
      const w = t.when;
      if (w.type !== 'sound') continue;
      // A changed condition starts afresh.
      const key = keyOf(t);
      seen.add(key);
      let st = this.sound.get(key);
      if (!st) {
        st = { since: null, offSince: now, fired: false };
        this.sound.set(key, st);
      }
      if (!t.enabled) {
        st.since = null;
        continue;
      }
      const db = toDb(levels.get(w.sourceId) ?? 0);
      const holds = w.above ? db >= w.db : db < w.db;
      if (holds) {
        st.offSince = null;
        st.since ??= now;
        if (!st.fired && now - st.since >= w.holdMs) {
          st.fired = true;
          out.push(t.id);
        }
      } else {
        st.since = null;
        st.offSince ??= now;
        if (st.fired && now - st.offSince >= REARM_MS) st.fired = false;
      }
    }
    // Forget triggers that were removed or changed.
    for (const k of [...this.sound.keys()]) if (!seen.has(k)) this.sound.delete(k);

    // Recording and streaming: on a change only (not what was already so when the window opened).
    const before = this.last;
    this.last = { ...broadcast };
    if (before) {
      for (const t of triggers) {
        const w = t.when;
        if (!t.enabled || w.type !== 'broadcast') continue;
        const was = w.what === 'record' ? before.recording : before.streaming;
        const is = w.what === 'record' ? broadcast.recording : broadcast.streaming;
        if (was !== is && is === w.on) out.push(t.id);
      }
    }
    return out;
  }
}

function keyOf(t: Trigger): string {
  const w = t.when;
  return w.type === 'sound' ? `${t.id}|${w.sourceId}|${w.above}|${w.db}|${w.holdMs}` : '';
}

/** In the control window: watch sound levels and recording/streaming, and run the triggers that go off. */
export function useTriggerWatch(show: Show, client: EngineClient, broadcast: BroadcastNow): void {
  const sound = useSound();
  const showRef = useRef(show);
  showRef.current = show;
  const bRef = useRef(broadcast);
  bRef.current = broadcast;
  const watch = useRef<TriggerWatch | null>(null);
  watch.current ??= new TriggerWatch();
  const fire = (ids: string[]) => {
    for (const id of ids) void client.dispatch({ type: 'fireTrigger', id }).catch(() => {});
  };
  // Recording and streaming changes are acted on at once.
  const { recording, streaming } = broadcast;
  useEffect(() => {
    fire(watch.current!.feed(showRef.current.triggers, sound?.levels ?? new Map(), { recording, streaming }, Date.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, streaming]);
  // Sound levels, ten times a second.
  const hasSound = show.triggers.some((t) => t.enabled && t.when.type === 'sound');
  useEffect(() => {
    if (!hasSound || !sound) return;
    const id = setInterval(() => fire(watch.current!.feed(showRef.current.triggers, sound.levels, bRef.current, Date.now())), 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSound, sound, client]);
}
