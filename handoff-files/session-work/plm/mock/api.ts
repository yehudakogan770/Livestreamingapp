// Dev-only fake data layer for screenshots. Not shipped.
import { blankCue, isoDate, type Plan, type PlanComment, type PlanCue, type PlanSummary, type Role } from '../../../../../../../home/user/Livestreamingapp/.claude/worktrees/agent-aa5adcd4cc3070437/planner/src/model';

export type Db = unknown;
export const plain = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));
export type PlanChange = Partial<Pick<Plan, 'name' | 'eventDate' | 'venue' | 'startTime' | 'notes'>>;
export interface Loaded {
  plan: Plan;
  cues: PlanCue[];
}
export interface Person {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

const today = new Date();
const start = new Date(today.getTime() - 22 * 60 * 1000);
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const day = (n: number) => isoDate(new Date(today.getTime() + n * 86_400_000));
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

const plans: Plan[] = [
  { id: P1, owner: 'me', name: 'Fall Benefit Dinner', eventDate: day(0), venue: 'Main hall', startTime: hhmm(start), notes: 'Crew call 5:00 PM.', updatedAt: Date.now() - 3600_000, updatedBy: 'Eli Cohen' },
  { id: P2, owner: 'me', name: 'Winter Concert — Livestream', eventDate: day(21), venue: 'Auditorium', startTime: '18:30', notes: '', updatedAt: Date.now() - 86_400_000 * 2, updatedBy: 'Dana Levi' },
  { id: P3, owner: 'x', name: 'Graduation 2026', eventDate: day(-60), venue: 'Gym', startTime: '10:00', notes: '', updatedAt: Date.now() - 86_400_000 * 40, updatedBy: 'Sara' },
];
let n = 0;
const mk = (planId: string, c: Partial<PlanCue>): PlanCue => ({ ...blankCue(planId, `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, n * 1024), updatedAt: 1, ...c });
const cues: PlanCue[] = [
  mk(P1, { section: 'Opening', title: 'Doors and pre-show loop', segment: 'countdown', durationSec: 600, who: 'Eli', input: 'Loop video', transition: 'Fade' }),
  mk(P1, { section: 'Opening', title: 'Welcome', segment: 'speaker', durationSec: 300, who: 'Rabbi Kogan', input: 'Camera 1', overlay: 'Lower third: Rabbi', transition: 'Cut' }),
  mk(P1, { section: 'Opening', title: 'Opening song', segment: 'lyrics', durationSec: 240, who: 'Choir', input: 'Camera 2', overlay: 'Lyrics', transition: 'Fade' }),
  mk(P1, { section: 'Program', title: 'Honoree video', segment: 'video', durationSec: 420, who: 'Dana', input: 'Video 1', transition: 'Dip', notes: 'Check audio level first' }),
  mk(P1, { section: 'Program', title: 'Keynote: building the future together', segment: 'speaker', durationSec: 1200, who: 'Dr. Miriam Stein', input: 'Camera 1', overlay: 'Lower third', transition: 'Cut' }),
  mk(P1, { section: 'Program', title: 'Dinner break', segment: 'break', durationSec: 1800, startTime: '', who: '', input: 'Slides', transition: 'Fade' }),
  mk(P1, { section: 'Program', title: '', segment: 'slide', durationSec: null, who: 'Avi', input: 'Slides' }),
  mk(P1, { section: 'Closing', title: 'Thank-yous and appeal', segment: 'camera', durationSec: 360, who: 'Board chair', input: 'Camera 2', transition: 'Cut' }),
  mk(P1, { section: 'Closing', title: 'Closing title', segment: 'title', durationSec: 60, input: 'Camera 3', overlay: 'Thank you', transition: 'Fade' }),
  mk(P2, { title: 'Pre-show', segment: 'countdown', durationSec: 900 }),
];
const comments: PlanComment[] = [
  { id: 'c1', planId: P1, cueId: cues[1]!.id, author: 'eli', authorName: 'Eli Cohen', text: 'Mic check at 5:30, wireless 2.', createdAt: Date.now() - 7200_000 },
  { id: 'c2', planId: P1, cueId: cues[1]!.id, author: 'me', authorName: 'Dana Levi', text: 'Got it.', createdAt: Date.now() - 3600_000 },
  { id: 'c3', planId: P1, cueId: cues[3]!.id, author: 'eli', authorName: 'Eli Cohen', text: 'Final cut arrives Thursday.', createdAt: Date.now() - 3600_000 },
];

const wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 30));

export const listPlans = async (_db: Db): Promise<PlanSummary[]> =>
  wait(
    plans.map((p) => ({
      id: p.id,
      name: p.name,
      eventDate: p.eventDate,
      venue: p.venue,
      startTime: p.startTime,
      role: p.owner === 'me' ? 'owner' : 'editor',
      ownerName: p.owner === 'me' ? 'Dana Levi' : 'Sara Gold',
      cueCount: cues.filter((c) => c.planId === p.id).length,
      updatedAt: p.updatedAt,
      updatedBy: p.updatedBy,
    })),
  );
export const loadPlan = async (_db: Db, id: string): Promise<Loaded> =>
  wait({ plan: { ...plans.find((p) => p.id === id)! }, cues: cues.filter((c) => c.planId === id).map((c) => ({ ...c })) });
export const loadComments = async (_db: Db, planId: string) => wait(comments.filter((c) => c.planId === planId));
export const myRole = async (_db: Db, planId: string): Promise<Role | null> => wait(new URLSearchParams(location.search).get('role') === 'viewer' ? 'viewer' : planId === P3 ? 'editor' : 'owner');
export const createPlan = async (_db: Db, name: string): Promise<Plan> => {
  const p: Plan = { id: '44444444-4444-4444-8444-444444444444', owner: 'me', name, eventDate: '', venue: '', startTime: '', notes: '', updatedAt: Date.now(), updatedBy: 'Dana Levi' };
  plans.push(p);
  return wait(p);
};
export const updatePlan = async (_db: Db, id: string, change: PlanChange) => {
  Object.assign(plans.find((p) => p.id === id)!, change);
  return wait(undefined);
};
export const deletePlan = async () => wait(undefined);
export const saveCues = async (_db: Db, list: PlanCue[]) => {
  for (const c of list) {
    const i = cues.findIndex((x) => x.id === c.id);
    const v = { ...c, updatedAt: Date.now(), updatedBy: 'Dana Levi' };
    if (i < 0) cues.push(v);
    else cues[i] = v;
  }
  return wait(list.map((c) => ({ ...c, updatedAt: Date.now(), updatedBy: 'Dana Levi' })));
};
export const deleteCue = async () => wait(undefined);
export const addComment = async (_db: Db, planId: string, cueId: string, text: string, userId: string): Promise<PlanComment> =>
  wait({ id: `c${Date.now()}`, planId, cueId, author: userId, authorName: 'Dana Levi', text, createdAt: Date.now() });
export const deleteComment = async () => wait(undefined);
export const people = async (): Promise<Person[]> =>
  wait([
    { userId: 'me', email: 'dana@example.org', name: 'Dana Levi', role: 'owner' as Role },
    { userId: 'eli', email: 'eli@example.org', name: 'Eli Cohen', role: 'editor' as Role },
  ]);
export const invite = async () => wait(undefined);
export const setRole = async () => wait(undefined);
export const removePerson = async () => wait(undefined);
export interface LiveHandlers {
  here: (names: string[]) => void;
  [k: string]: unknown;
}
export function watchPlan(_db: Db, _id: string, _me: unknown, on: LiveHandlers): () => void {
  const t = setTimeout(() => on.here(['Eli Cohen']), 50);
  return () => clearTimeout(t);
}
