// A plan's lists (crew, contacts, tasks, gear, budget), live: they load,
// everyone's changes come in, and each item changed here is saved a moment
// after the last keystroke.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pro from './apiPro';
import { blankItem, type Item, type ItemKind } from './items';
import { db } from './session';
import { rememberPlan, savedPlan, unreachable } from './offlineCache';

const SAVE_AFTER_MS = 600;
const RETRY_MS = 5000;

export interface ItemStore {
  items: Item[];
  loaded: boolean;
  error: string;
  /** The server has the lists (update 10). */
  ready: boolean;
  add: (kind: ItemKind, init?: Partial<Item>) => string;
  addMany: (list: (Partial<Item> & { kind: ItemKind })[]) => void;
  edit: (id: string, change: Partial<Item>) => void;
  /** Tick a task off (the task's person may, even as a viewer). */
  tick: (id: string, done: boolean) => void;
  remove: (id: string) => void;
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

const merge = (list: Item[], incoming: Item, pending: Set<string>): Item[] => {
  const i = list.findIndex((x) => x.id === incoming.id);
  if (i < 0) return [...list, incoming];
  if (pending.has(incoming.id)) return list;
  const next = [...list];
  next[i] = incoming;
  return next;
};

export function useItems(planId: string, enabled = true): ItemStore {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(true);
  const ref = useRef<Item[]>([]);
  ref.current = items;
  const dirty = useRef(new Map<string, number>());
  const fromCopy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setItems([]);
    setLoaded(false);
    setError('');
    pro
      .loadItems(db(), planId)
      .then((list) => {
        if (!live) return;
        setItems(list);
        setLoaded(true);
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!live) return;
        const m = e instanceof Error ? e.message : String(e);
        // No internet: the copy kept on this device.
        const copy = unreachable(e) ? savedPlan(planId)?.items : undefined;
        if (copy) {
          setItems(copy);
          fromCopy.current = true;
        } else if (/update-10/.test(m)) setReady(false);
        else setError(m);
        setLoaded(true);
      });
    const stop = pro.watchItems(db(), planId, {
      item: (it) => setItems((list) => merge(list, it, new Set(dirty.current.keys()))),
      gone: (id) => {
        dirty.current.delete(id);
        setItems((list) => list.filter((x) => x.id !== id));
      },
    });
    return () => {
      live = false;
      stop();
    };
  }, [planId, enabled]);

  // A copy on this device, for when there is no internet.
  useEffect(() => {
    if (!loaded || fromCopy.current || !ready) return;
    const t = setTimeout(() => rememberPlan(planId, { items }), 800);
    return () => clearTimeout(t);
  }, [planId, items, loaded, ready]);

  const flush = useCallback(async () => {
    timer.current = null;
    if (busy.current) {
      timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
      return;
    }
    const snapshot = new Map(dirty.current);
    if (!snapshot.size) return;
    busy.current = true;
    try {
      const toSave = ref.current.filter((x) => snapshot.has(x.id));
      for (const id of snapshot.keys()) if (!toSave.some((x) => x.id === id)) dirty.current.delete(id);
      const saved = await pro.saveItems(db(), toSave);
      for (const s of saved) if (dirty.current.get(s.id) === snapshot.get(s.id)) dirty.current.delete(s.id);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      timer.current = setTimeout(() => void flush(), RETRY_MS);
    } finally {
      busy.current = false;
    }
    if (!timer.current && dirty.current.size) timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }, []);

  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }, [flush]);

  useEffect(() => {
    const now = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void flush();
      }
    };
    window.addEventListener('pagehide', now);
    return () => {
      window.removeEventListener('pagehide', now);
      now();
    };
  }, [flush]);

  const touch = (id: string) => dirty.current.set(id, (dirty.current.get(id) ?? 0) + 1);
  const nextSort = () => Math.max(0, ...ref.current.map((x) => x.sort)) + 1024;

  const add = useCallback(
    (kind: ItemKind, init: Partial<Item> = {}): string => {
      const id = newId();
      const it = { ...blankItem(planId, id, kind, nextSort()), ...init, id, planId, kind };
      const next = [...ref.current, it];
      ref.current = next;
      setItems(next);
      touch(id);
      soon();
      return id;
    },
    [planId, soon],
  );

  const addMany = useCallback(
    (list: (Partial<Item> & { kind: ItemKind })[]) => {
      let sort = nextSort();
      const made = list.map((init) => {
        const id = newId();
        touch(id);
        sort += 1024;
        return { ...blankItem(planId, id, init.kind, sort), ...init, id, planId };
      });
      const next = [...ref.current, ...made];
      ref.current = next;
      setItems(next);
      soon();
    },
    [planId, soon],
  );

  const edit = useCallback(
    (id: string, change: Partial<Item>) => {
      setItems((list) => list.map((x) => (x.id === id ? { ...x, ...change } : x)));
      touch(id);
      soon();
    },
    [soon],
  );

  const tick = useCallback((id: string, done: boolean) => {
    setItems((list) => list.map((x) => (x.id === id ? { ...x, done } : x)));
    pro.taskDone(db(), id, done).catch((e: unknown) => {
      setItems((list) => list.map((x) => (x.id === id ? { ...x, done: !done } : x)));
      setError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  const remove = useCallback((id: string) => {
    dirty.current.delete(id);
    setItems((list) => list.filter((x) => x.id !== id));
    pro.deleteItems(db(), [id]).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return { items, loaded, error, ready, add, addMany, edit, tick, remove };
}
