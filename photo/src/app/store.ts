// A tiny store: state held in one object, changed with set(), watched by
// React through useSyncExternalStore with a selector.

import { useRef, useSyncExternalStore } from 'react';

export class Store<T extends object> {
  private state: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  get = (): T => this.state;

  set = (patch: Partial<T> | ((s: T) => Partial<T>)): void => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of [...this.listeners]) l();
  };

  /** Tell watchers something inside changed (mutable parts like sessions). */
  touch = (): void => {
    this.state = { ...this.state };
    for (const l of [...this.listeners]) l();
  };

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object),
    kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** Watch part of a store; re-renders only when the selected value changes (shallowly). */
export function useStore<T extends object, S>(store: Store<T>, select: (s: T) => S): S {
  const last = useRef<{ s: S } | null>(null);
  const get = () => {
    const next = select(store.get());
    if (last.current && shallowEqual(last.current.s, next)) return last.current.s;
    last.current = { s: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}
