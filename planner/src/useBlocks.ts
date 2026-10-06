// A plan's schedule, live: blocks load, everyone's changes come in, and each
// block changed here is saved a moment after the last keystroke.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { blankBlock, mergeBlock, sortBlocks, type Block } from './blocks';
import { db } from './session';

const SAVE_AFTER_MS = 600;
const RETRY_MS = 5000;

export interface BlockStore {
  blocks: Block[];
  loaded: boolean;
  error: string;
  add: (day: string, init?: Partial<Block>) => string;
  addMany: (list: Partial<Block>[]) => void;
  edit: (id: string, change: Partial<Block>) => void;
  remove: (id: string) => void;
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

export function useBlocks(planId: string): BlockStore {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<Block[]>([]);
  ref.current = blocks;
  /** Blocks changed here and not saved yet: id → edit count. */
  const dirty = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    setBlocks([]);
    setLoaded(false);
    setError('');
    api
      .loadBlocks(db(), planId)
      .then((list) => {
        if (!live) return;
        setBlocks(sortBlocks(list));
        setLoaded(true);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    const stop = api.watchBlocks(db(), planId, {
      block: (b) => setBlocks((list) => sortBlocks(mergeBlock(list, b, new Set(dirty.current.keys())))),
      gone: (id) => {
        dirty.current.delete(id);
        setBlocks((list) => list.filter((b) => b.id !== id));
      },
    });
    return () => {
      live = false;
      stop();
    };
  }, [planId]);

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
      const toSave = ref.current.filter((b) => snapshot.has(b.id));
      for (const id of snapshot.keys()) if (!toSave.some((b) => b.id === id)) dirty.current.delete(id);
      const saved = await api.saveBlocks(db(), toSave);
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

  const add = useCallback(
    (day: string, init: Partial<Block> = {}): string => {
      const id = newId();
      const sort = Math.max(0, ...ref.current.map((b) => b.sort)) + 1024;
      const b = { ...blankBlock(planId, id, day, sort), ...init, id, planId };
      const next = sortBlocks([...ref.current, b]);
      ref.current = next;
      setBlocks(next);
      touch(id);
      soon();
      return id;
    },
    [planId, soon],
  );

  const addMany = useCallback(
    (list: Partial<Block>[]) => {
      let sort = Math.max(0, ...ref.current.map((b) => b.sort));
      const made = list.map((init) => {
        sort += 1024;
        const id = newId();
        touch(id);
        return { ...blankBlock(planId, id, '', sort), ...init, id, planId };
      });
      const next = sortBlocks([...ref.current, ...made]);
      ref.current = next;
      setBlocks(next);
      soon();
    },
    [planId, soon],
  );

  const edit = useCallback(
    (id: string, change: Partial<Block>) => {
      setBlocks((list) => sortBlocks(list.map((b) => (b.id === id ? { ...b, ...change } : b))));
      touch(id);
      soon();
    },
    [soon],
  );

  const remove = useCallback((id: string) => {
    dirty.current.delete(id);
    setBlocks((list) => list.filter((b) => b.id !== id));
    api.deleteBlock(db(), id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return { blocks, loaded, error, add, addMany, edit, remove };
}
