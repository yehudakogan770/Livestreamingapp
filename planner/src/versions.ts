// What changed between a saved version of a plan and the plan now. No
// network and no React here.

import { cueLabel, sortCues, type PlanCue } from './model';

const FIELDS: [keyof PlanCue, string][] = [
  ['title', 'name'],
  ['section', 'section'],
  ['segment', 'type'],
  ['who', 'who'],
  ['startTime', 'fixed start'],
  ['durationSec', 'length'],
  ['notes', 'notes'],
  ['script', 'script'],
  ['input', 'input'],
  ['overlay', 'title or overlay'],
  ['transition', 'transition'],
  ['color', 'color'],
  ['skip', 'floated'],
];

export interface CueChange {
  id: string;
  title: string;
  /** What changed, in words ("length", "notes"). */
  what: string[];
}

export interface Diff {
  added: string[];
  removed: string[];
  changed: CueChange[];
  /** The order changed. */
  moved: boolean;
}

/** From `then` (a version) to `now`: cue names added, removed, changed, and whether the order changed. */
export function diffCues(then: readonly PlanCue[], now: readonly PlanCue[]): Diff {
  const a = sortCues(then);
  const b = sortCues(now);
  const old = new Map(a.map((c) => [c.id, c]));
  const cur = new Map(b.map((c) => [c.id, c]));
  const added = b.filter((c) => !old.has(c.id)).map(cueLabel);
  const removed = a.filter((c) => !cur.has(c.id)).map(cueLabel);
  const changed: CueChange[] = [];
  for (const c of b) {
    const o = old.get(c.id);
    if (!o) continue;
    const what = FIELDS.filter(([k]) => o[k] !== c[k]).map(([, w]) => w);
    if (JSON.stringify(o.custom) !== JSON.stringify(c.custom)) what.push('extra columns');
    if (what.length) changed.push({ id: c.id, title: cueLabel(c), what });
  }
  const keptA = a.filter((c) => cur.has(c.id)).map((c) => c.id);
  const keptB = b.filter((c) => old.has(c.id)).map((c) => c.id);
  return { added, removed, changed, moved: keptA.join() !== keptB.join() };
}

/** "3 cues changed, 1 added, order changed" (or "No changes to the cues"). */
export function diffWords(d: Diff): string {
  const parts = [
    d.changed.length && `${d.changed.length} cue${d.changed.length === 1 ? '' : 's'} changed`,
    d.added.length && `${d.added.length} added since`,
    d.removed.length && `${d.removed.length} deleted since`,
    d.moved && 'order changed',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No changes to the cues';
}
