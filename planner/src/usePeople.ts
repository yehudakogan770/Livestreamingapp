// Everyone on a plan (owner, editors, viewers), for @mentions and giving tasks.

import { useEffect, useState } from 'react';
import { people, type Person } from './api';
import { db } from './session';

const cache = new Map<string, Person[]>();

export function usePeople(planId: string, enabled = true): Person[] {
  const [list, setList] = useState<Person[]>(() => cache.get(planId) ?? []);
  useEffect(() => {
    if (!enabled) return;
    let on = true;
    people(db(), planId)
      .then((p) => {
        cache.set(planId, p);
        if (on) setList(p);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [planId, enabled]);
  return list;
}

/** A person's name to show. */
export const personName = (p: Person): string => p.name || p.email;
