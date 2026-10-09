// One open plan, kept in step with everyone else's edits. Each cue is saved
// on its own a moment after the last keystroke; a cue with changes not yet
// saved keeps them when someone else's version of it comes in (they go up next
// and win: last write wins, per cue).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { blankCue, mergeCue, moveCue, positionAfter, removeCue, sortCues, type Plan, type PlanComment, type PlanCue, type Role } from './model';
import { savedPlan, rememberPlan, unreachable } from './offlineCache';
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
  /** Shown from the copy kept on this device (no internet): read-only. */
  fromCopy: boolean;
  editPlan: (change: api.PlanChange) => void;
  /** Change the plan here only (what the server already changed, like the public link). */
  patchPlan: (change: Partial<Plan>) => void;
  editCue: (id: string, change: Partial<PlanCue>) => void;
  addCue: (afterId: string | null) => string | null;
  duplicateCue: (id: string) => string | null;
  deleteCue: (id: string) => void;
  move: (from: number, to: number) => void;
  comment: (cueId: string, text: string, mentions?: string[]) => Promise<void>;
  /** Put many cues in at once (import, a version's cues): after `afterId`, or at the end. */
  addCues: (list: Partial<PlanCue>[], afterId?: string | null) => string[];
  /** Change many cues at once (lengths from a rehearsal). */
  editCues: (changes: Map<string, Partial<PlanCue>>) => void;
  uncomment: (id: string) => void;
  reloadRole: () => void;
}

export { unreachable } from './offlineCache';

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
  const [fromCopy, setFromCopy] = useState(false);

  const cuesRef = useRef<PlanCue[]>([]);
  cuesRef.current = cues;
  const proRef = useRef(true);
  proRef.current = plan?.pro ?? true;
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
    setFromCopy(false);
    Promise.all([api.loadPlan(db(), planId), api.loadComments(db(), planId), api.myRole(db(), planId)])
      .then(([loaded, cs, r]) => {
        if (!live) return;
        setPlan(loaded.plan);
        setCues(sortCues(loaded.cues));
        setComments(cs);
        setRole(r);
      })
      .catch((e: unknown) => {
        if (!live) return;
        // No internet: the copy kept on this device, to read only.
        const copy = unreachable(e) ? savedPlan(planId) : null;
        if (copy?.plan) {
          setPlan(copy.plan);
          setCues(sortCues(copy.cues ?? []));
          setComments(copy.comments ?? []);
          setRole('viewer');
          setFromCopy(true);
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      });
    // Others' cue changes arrive one message each (a reorder of 200 cues is 200 of them):
    // gathered for a moment and put on screen together, sorted once.
    let waiting: ((list: PlanCue[]) => PlanCue[])[] = [];
    let batch: ReturnType<typeof setTimeout> | null = null;
    const later = (f: (list: PlanCue[]) => PlanCue[]) => {
      waiting.push(f);
      batch ??= setTimeout(() => {
        const fs = waiting;
        waiting = [];
        batch = null;
        if (live) setCues((list) => sortCues(fs.reduce((l, g) => g(l), list)));
      }, 30);
    };
    const stop = api.watchPlan(db(), planId, me, {
      cue: (c) => later((list) => mergeCue(list, c, new Set(dirty.current.keys()))),
      cueGone: (id) => {
        // Deleted by someone else: changes here to it are dropped, not brought back.
        dirty.current.delete(id);
        later((list) => removeCue(list, id));
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
      if (batch) clearTimeout(batch);
      stop();
    };
  }, [planId, me, reloadRole]);

  // Keep a copy on this device of what is on screen, for when there is no internet.
  useEffect(() => {
    if (!plan || fromCopy || role === null) return;
    const t = setTimeout(() => rememberPlan(planId, { plan, cues, comments, role }), 800);
    return () => clearTimeout(t);
  }, [planId, plan, cues, comments, role, fromCopy]);

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
      const saved = await api.saveCues(db(), toSave, proRef.current);
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

  const patchPlan = useCallback((change: Partial<Plan>) => setPlan((p) => (p ? { ...p, ...change } : p)), []);

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
    async (cueId: string, text: string, mentions: string[] = []) => {
      // The cue must be on the server first.
      if (dirty.current.has(cueId)) await flush();
      const c = await api.addComment(db(), planId, cueId, text, me.id, mentions);
      setComments((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
    },
    [planId, me.id, flush],
  );

  const addCues = useCallback(
    (list: Partial<PlanCue>[], afterId: string | null = null): string[] => {
      const cur = cuesRef.current;
      const sorted = sortCues(cur);
      const i = afterId ? sorted.findIndex((c) => c.id === afterId) : sorted.length - 1;
      const before = i >= 0 ? sorted[i]!.position : 0;
      const after = i >= 0 ? (sorted[i + 1]?.position ?? before + (list.length + 1) * 1024) : (sorted[0]?.position ?? (list.length + 1) * 1024);
      const step = (after - before) / (list.length + 1);
      const made = list.map((init, k) => ({ ...blankCue(planId, newId(), before + step * (k + 1)), ...init, planId, updatedAt: 0 }));
      for (const c of made) {
        c.id = c.id || newId();
        touch(c.id);
      }
      const next = sortCues([...cur, ...made]);
      cuesRef.current = next;
      setCues(next);
      soon();
      return made.map((c) => c.id);
    },
    [planId, soon],
  );

  const editCues = useCallback(
    (changes: Map<string, Partial<PlanCue>>) => {
      setCues((list) => list.map((c) => (changes.has(c.id) ? { ...c, ...changes.get(c.id) } : c)));
      for (const id of changes.keys()) touch(id);
      soon();
    },
    [soon],
  );

  const uncomment = useCallback((id: string) => {
    setComments((list) => list.filter((c) => c.id !== id));
    api.deleteComment(db(), id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return {
    plan,
    cues,
    comments,
    role,
    here,
    error,
    gone,
    saving,
    fromCopy,
    editPlan,
    patchPlan,
    editCue,
    addCue,
    duplicateCue,
    deleteCue,
    move,
    comment,
    uncomment,
    reloadRole,
    addCues,
    editCues,
  };
}
