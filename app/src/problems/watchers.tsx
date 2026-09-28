// Watch the parts of the app that can go wrong on their own (sound devices,
// output windows, displays, the engine) and report to the problem centre.

import { useEffect, useRef } from 'react';
import type { EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { useSound } from '../audio/SoundContext';
import { SCREENS } from '../components/ScreenSelector';
import { useProblemStore } from './problems';

/** Output windows Lumora itself was asked to close (so their closing is not a problem). */
export const expectedCloses = new Set<ScreenId>();

const screenName = (id: ScreenId) => SCREENS.find((s) => s.id === id)?.name ?? id;

/** Sound: inputs that give no sound, and sound held back until the first click. */
export function SoundWatcher({ show }: { show: Show }) {
  const store = useProblemStore();
  const sound = useSound();
  const me = useRef(Symbol('sound')).current;
  const latest = useRef(show);
  latest.current = show;
  useEffect(() => {
    if (!store || !sound) return;
    const check = () => {
      const s = latest.current;
      const bad = new Set(sound.problems);
      for (const src of s.sources) {
        const key = `sound:${src.id}`;
        if (bad.has(src.id)) {
          store.report(me, {
            key,
            level: 'error',
            title: `${src.name}: no sound`,
            detail: src.kind.type === 'microphone' ? 'The microphone could not be opened, or it was unplugged.' : 'The sound in this file could not be played.',
            fix: src.kind.type === 'microphone' ? 'Check its cable and that Lumora is allowed to use it, then choose it again with + Add input.' : 'Check the file still exists and plays in another program.',
            sourceId: src.id,
          });
        } else store.clear(me, key);
      }
      if (sound.waitingForClick && s.sources.some((x) => x.kind.type === 'video' || x.kind.type === 'microphone')) {
        store.report(me, {
          key: 'sound:waiting',
          level: 'warning',
          title: 'Sound is waiting to start',
          detail: 'The computer only allows sound after the first click or key press in Lumora.',
          fix: 'Click anywhere in Lumora.',
        });
      } else store.clear(me, 'sound:waiting');
    };
    check();
    const id = setInterval(check, 1000);
    return () => {
      clearInterval(id);
      store.clearAll(me, 'sound:');
    };
  }, [store, sound, me]);
  return null;
}

/** Output windows that closed by themselves, and chosen displays that are not connected. */
export function OutputWatcher({ show, client, open, onOpenOutputs }: { show: Show; client: EngineClient; open: ScreenId[]; onOpenOutputs: () => void }) {
  const store = useProblemStore();
  const me = useRef(Symbol('outputs')).current;
  const before = useRef<ScreenId[]>([]);

  useEffect(() => {
    if (!store) return;
    for (const s of before.current) {
      if (!open.includes(s)) {
        if (expectedCloses.delete(s)) continue;
        store.report(me, {
          key: `output-closed:${s}`,
          level: 'error',
          title: `The ${screenName(s)} output window closed`,
          detail: 'Nothing is being shown on that screen now.',
          action: { label: 'Open it again', run: () => void client.openOutput(s).catch(() => {}) },
        });
      }
    }
    for (const s of open) store.clear(me, `output-closed:${s}`);
    before.current = open;
  }, [open, store, me, client]);

  const displays = show.settings.displays;
  useEffect(() => {
    if (!store) return;
    let alive = true;
    const check = () =>
      void client.listDisplays().then(
        (list) => {
          if (!alive) return;
          for (const s of SCREENS) {
            const want = displays[s.id];
            const key = `display:${s.id}`;
            if (want && !list.some((d) => d.id === want)) {
              store.report(me, {
                key,
                level: 'error',
                title: `The display for the ${s.name} is not connected`,
                detail: `“${want}” can't be found.`,
                fix: 'Check its cable and that it is switched on, or choose another display.',
                action: { label: 'Open Outputs', run: onOpenOutputs },
              });
            } else store.clear(me, key);
          }
        },
        () => {},
      );
    check();
    const id = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [store, me, client, displays, onOpenOutputs]);

  useEffect(() => () => store?.clearAll(me, ''), [store, me]);
  return null;
}
