// The problem center: anything wrong anywhere in the app is reported here the
// moment it happens, shown as a light on the bottom bar, a message, and a
// list with what to do about it.

import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

export interface Problem {
  /** One problem per key (e.g. `source:src-3`); reporting again updates it. */
  key: string;
  /** Errors affect what the audience sees or hears; warnings are worth knowing. */
  level: 'error' | 'warning';
  title: string;
  /** What it means, in plain words. */
  detail?: string;
  /** What to do about it. */
  fix?: string;
  /** A button that fixes it, when Lumora can. */
  action?: { label: string; run: () => void };
  /** The input it is about, for the ⚠ on its tile. */
  sourceId?: string;
  since: number;
}

type Listener = () => void;

/**
 * Problems, each held by one or more reporters (e.g. the tile and the Next
 * monitor both notice a missing file); a problem goes away when every
 * reporter says it is fixed.
 */
export class ProblemStore {
  private problems = new Map<string, Problem>();
  private reporters = new Map<string, Set<symbol>>();
  private listeners = new Set<Listener>();
  private list: Problem[] = [];
  /** Called for every problem that is new (not just updated). */
  onNew: ((p: Problem) => void) | null = null;

  report(who: symbol, p: Omit<Problem, 'since'>): void {
    const had = this.problems.get(p.key);
    const holders = this.reporters.get(p.key) ?? new Set();
    holders.add(who);
    this.reporters.set(p.key, holders);
    const next: Problem = { ...p, since: had?.since ?? Date.now() };
    if (had && JSON.stringify({ ...had, action: undefined }) === JSON.stringify({ ...next, action: undefined })) return;
    this.problems.set(p.key, next);
    this.changed();
    if (!had) this.onNew?.(next);
  }

  clear(who: symbol, key: string): void {
    const holders = this.reporters.get(key);
    if (!holders) return;
    holders.delete(who);
    if (holders.size > 0) return;
    this.reporters.delete(key);
    if (this.problems.delete(key)) this.changed();
  }

  /** Clear every key starting with `prefix` that `who` holds. */
  clearAll(who: symbol, prefix: string): void {
    for (const key of [...this.reporters.keys()]) if (key.startsWith(prefix)) this.clear(who, key);
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  snapshot = (): Problem[] => this.list;

  private changed() {
    this.list = [...this.problems.values()].sort((a, b) => (a.level === b.level ? a.since - b.since : a.level === 'error' ? -1 : 1));
    for (const l of this.listeners) l();
  }
}

const Ctx = createContext<ProblemStore | null>(null);

export function ProblemsProvider({ store, children }: { store: ProblemStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useProblemStore(): ProblemStore | null {
  return useContext(Ctx);
}

/** The current problems (empty outside the control window). */
export function useProblems(): Problem[] {
  const store = useContext(Ctx);
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.snapshot ?? noProblems, noProblems);
}

const noSubscribe = () => () => {};
const empty: Problem[] = [];
const noProblems = () => empty;

/**
 * Report a problem while `problem` is set, and clear it when it is null or the
 * component goes away. Does nothing outside the control window.
 */
export function useReportProblem(problem: Omit<Problem, 'since'> | null): void {
  const store = useContext(Ctx);
  const me = useRef(Symbol('reporter')).current;
  const key = problem?.key ?? null;
  const json = problem ? JSON.stringify({ ...problem, action: undefined }) : null;
  const latest = useRef(problem);
  latest.current = problem;
  useEffect(() => {
    if (!store || !key || !latest.current) return;
    store.report(me, latest.current);
    return () => store.clear(me, key);
  }, [store, me, key, json]);
}
