// One open plan, kept in step with everyone else's edits. Each cue is saved
// on its own a moment after the last keystroke; a cue with changes not yet
// saved keeps them when someone else's version of it comes in (they go up next
// and win: last write wins, per cue).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { blankCue, mergeCue, moveCue, positionAfter, removeCue, sortCues, type Plan, type PlanComment, type PlanCue, type Role } from './model';
import { db } from './session';

const SAVE_AFTER_MS = 600;
const RETRY_MS = 5000;

export type SaveState = 'saved' | 'saving' | 'offline';

export interface PlanStore {
  plan: Plan | null;
  cues: PlanCue[];
  comments: PlanComment[];
  role: Role | null;
  here: string[];
  error: string;
  gone: boolean;
  saving: SaveState;
  editPlan: (change: api.PlanChange) => void;
  editCue: (id: string, change: Partial<PlanCue>) => void;
  addCue: (afterId: string | null) => string | null;
  duplicateCue: (id: string) => string | null;
  deleteCue: (id: string) => void;
  move: (from: number, to: number) => void;
  comment: (cueId: string, text: string) => Promise<void>;
  uncomment: (id: string) => void;
  reloadRole: () => void;
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

export function usePlan(planId: string, me: { id: string; name: string }): PlanStore {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [cues, setCues] = useState<PlanCue[]>([]);
  const [comments, setComments] = useState<PlanComment[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [here, setHere] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [gone, setGone] = useState(false);
  const [saving, setSaving] = useState<SaveState>('saved');

  const cuesRef = useRef<PlanCue[]>([]);
  cuesRef.current = cues;
  /** Cues changed here and not saved yet: id → edit count. */
  const dirty = useRef(new Map<string, number>());
  const planDirty = useRef<api.PlanChange>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  const reloadRole = useCallback(() => {
    api
      .myRole(db(), planId)
      .then((r) => {
        setRole(r);
        if (r === null) setGone(true);
      })
      .catch(() => {});
  }, [planId]);

  useEffect(() => {
    let live = true;
    setPlan(null);
    setCues([]);
    setComments([]);
    setError('');
    setGone(false);
    Promise.all([api.loadPlan(db(), planId), api.loadComments(db(), planId), api.myRole(db(), planId)])
      .then(([loaded, cs, r]) => {
        if (!live) return;
        setPlan(loaded.plan);
        setCues(sortCues(loaded.cues));
        setComments(cs);
        setRole(r);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    const stop = api.watchPlan(db(), planId, me, {
      cue: (c) => setCues((list) => sortCues(mergeCue(list, c, new Set(dirty.current.keys())))),
      cueGone: (id) => {
        // Deleted by someone else: changes here to it are dropped, not brought back.
        dirty.current.delete(id);
        setCues((list) => removeCue(list, id));
        setComments((list) => list.filter((c) => c.cueId !== id));
      },
      plan: (p) =>
        setPlan((old) => {
          const keep = planDirty.current;
          return old ? { ...p, ...keep } : p;
        }),
      planGone: () => setGone(true),
      comment: (c) => setComments((list) => (list.some((x) => x.id === c.id) ? list : [...list, c])),
      commentGone: (id) => setComments((list) => list.filter((c) => c.id !== id)),
      members: () => reloadRole(),
      here: setHere,
    });
    return () => {
      live = false;
      stop();
    };
  }, [planId, me, reloadRole]);

  const flush = useCallback(async () => {
    timer.current = null;
    if (busy.current) {
      timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
      return;
    }
    const snapshot = new Map(dirty.current);
    const change = planDirty.current;
    if (!snapshot.size && !Object.keys(change).length) return;
    busy.current = true;
    setSaving('saving');
    try {
      if (Object.keys(change).length) {
        planDirty.current = {};
        try {
          await api.updatePlan(db(), planId, change);
        } catch (e) {
          planDirty.current = { ...change, ...planDirty.current };
          throw e;
        }
      }
      const toSave = cuesRef.current.filter((c) => snapshot.has(c.id));
      for (const id of snapshot.keys()) if (!toSave.some((c) => c.id === id)) dirty.current.delete(id);
      const saved = await api.saveCues(db(), toSave);
      setCues((list) => {
        let next = list;
        for (const s of saved) {
          const unchanged = dirty.current.get(s.id) === snapshot.get(s.id);
          if (unchanged) dirty.current.delete(s.id);
          // Typed into since: keep what is here, with the server's time.
          next = next.map((c) => (c.id === s.id ? (unchanged ? s : { ...c, updatedAt: s.updatedAt }) : c));
        }
        return sortCues(next);
      });
      setSaving('saved');
      setError('');
    } catch (e) {
      setSaving('offline');
      setError(e instanceof Error ? e.message : String(e));
      timer.current = setTimeout(() => void flush(), RETRY_MS);
    } finally {
      busy.current = false;
    }
    if (!timer.current && (dirty.current.size || Object.keys(planDirty.current).length)) timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }, [planId]);

  const soon = useCallback(() => {
    setSaving('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }, [flush]);

  // Save what is waiting when leaving the plan or the page.
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

  const editPlan = useCallback(
    (change: api.PlanChange) => {
      setPlan((p) => (p ? { ...p, ...change } : p));
      planDirty.current = { ...planDirty.current, ...change };
      soon();
    },
    [soon],
  );

  const editCue = useCallback(
    (id: string, change: Partial<PlanCue>) => {
      setCues((list) => list.map((c) => (c.id === id ? { ...c, ...change } : c)));
      touch(id);
      soon();
    },
    [soon],
  );

  const addCue = useCallback(
    (afterId: string | null): string | null => {
      const list = cuesRef.current;
      const id = newId();
      const after = afterId ? list.find((c) => c.id === afterId) : list.at(-1);
      const cue = blankCue(planId, id, positionAfter(list, afterId), after?.section ?? '');
      const next = sortCues([...list, cue]);
      cuesRef.current = next;
      setCues(next);
      touch(id);
      soon();
      return id;
    },
    [planId, soon],
  );

  const duplicateCue = useCallback(
    (id: string): string | null => {
      const list = cuesRef.current;
      const src = list.find((c) => c.id === id);
      if (!src) return null;
      const copy: PlanCue = { ...src, id: newId(), position: positionAfter(list, id), updatedAt: 0 };
      const next = sortCues([...list, copy]);
      cuesRef.current = next;
      setCues(next);
      touch(copy.id);
      soon();
      return copy.id;
    },
    [soon],
  );

  const deleteCue = useCallback(
    (id: string) => {
      dirty.current.delete(id);
      setCues((list) => removeCue(list, id));
      setComments((list) => list.filter((c) => c.cueId !== id));
      api.deleteCue(db(), id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [setCues],
  );

  const move = useCallback(
    (from: number, to: number) => {
      const changed = moveCue(cuesRef.current, from, to);
      if (!changed.length) return;
      const pos = new Map(changed.map((c) => [c.id, c.position]));
      const next = sortCues(cuesRef.current.map((c) => (pos.has(c.id) ? { ...c, position: pos.get(c.id)! } : c)));
      cuesRef.current = next;
      setCues(next);
      for (const id of pos.keys()) touch(id);
      soon();
    },
    [soon],
  );

  const comment = useCallback(
    async (cueId: string, text: string) => {
      // The cue must be on the server first.
      if (dirty.current.has(cueId)) await flush();
      const c = await api.addComment(db(), planId, cueId, text, me.id);
      setComments((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
    },
    [planId, me.id, flush],
  );

  const uncomment = useCallback((id: string) => {
    setComments((list) => list.filter((c) => c.id !== id));
    api.deleteComment(db(), id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return { plan, cues, comments, role, here, error, gone, saving, editPlan, editCue, addCue, duplicateCue, deleteCue, move, comment, uncomment, reloadRole };
}
