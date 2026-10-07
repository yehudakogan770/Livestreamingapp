// The sign-in rules and on/off switches the Lumora team sets (People and
// approvals → Sign-in settings and Features), as the apps receive them from
// the server (sign_in_rules(), supabase/update-9-sign-in-settings.sql). The
// server decides and enforces them; the apps only follow along.

/** The three apps, then the features, as the server names them. */
export type AppKey = 'lumora' | 'studio' | 'planner';
export type FeatureKey =
  | AppKey
  | 'planner_chat'
  | 'planner_sharing'
  | 'studio_sharing'
  | 'problem_reports'
  | 'audience_link'
  | 'captions'
  | 'ai_tools'
  | 'stream_deck'
  | 'update_prompt';

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  /** What turning it off does, in plain words. */
  help: string;
  /** Checked on the server too (not only in the apps). */
  server?: boolean;
}

export const APP_FEATURES: FeatureInfo[] = [
  { key: 'lumora', label: 'Lumora', help: 'When off, Lumora shows your message instead of opening (a show already running keeps going).' },
  {
    key: 'studio',
    label: 'Lumora Studio',
    help: 'When off, Lumora Studio shows your message instead of opening, and its team projects are closed.',
    server: true,
  },
  { key: 'planner', label: 'Lumora Planner', help: 'When off, the Planner shows your message and plans can’t be opened or changed.', server: true },
];

export const FEATURES: FeatureInfo[] = [
  { key: 'planner_chat', label: 'Planner chat', help: 'Messages in a plan’s chat. When off, nobody can send new messages.', server: true },
  { key: 'planner_sharing', label: 'Planner sharing and invitations', help: 'Owners sharing plans with other people by email.', server: true },
  {
    key: 'studio_sharing',
    label: 'Studio team sharing and comments',
    help: 'Sharing Lumora Studio projects with a team, and commenting on them.',
    server: true,
  },
  { key: 'problem_reports', label: 'Problem reports and screenshots', help: '“Report a problem” and automatic error reports.', server: true },
  { key: 'audience_link', label: 'Internet audience link', help: 'The link that lets viewers watch over the internet (Cloudflare tunnel).' },
  { key: 'captions', label: 'Live captions', help: 'Automatic captions during a show.' },
  { key: 'ai_tools', label: 'AI features', help: 'Masks, tracking and the other smart tools.' },
  { key: 'stream_deck', label: 'Stream Deck plugin offer', help: 'The offer to install the Stream Deck plugin.' },
  { key: 'update_prompt', label: 'Automatic update prompt', help: 'The note that a new version of Lumora is ready to install.' },
];

export const ALL_FEATURES: FeatureInfo[] = [...APP_FEATURES, ...FEATURES];
export const featureLabel = (k: string): string => ALL_FEATURES.find((f) => f.key === k)?.label ?? k;

export const OFFLINE_CHOICES = [1, 3, 7, 14, 30] as const;
export const DEFAULT_OFFLINE_DAYS = 7;

export interface SignInRules {
  signups: 'open' | 'closed';
  twoStep: 'optional' | 'team' | 'everyone';
  /** This account must use two-step sign-in. */
  twoStepRequired: boolean;
  /** How many days the apps keep working without checking in. */
  offlineDays: number;
  plannerMakers: 'lumora' | 'anyone';
  /** This account may make new plans (null: the server did not say). */
  canMakePlans: boolean | null;
  /** The Lumora team's words for the waiting and no-access screens ('' : the usual ones). */
  waitingMessage: string;
  /** Each switch for this account (missing: on). */
  features: Partial<Record<FeatureKey, boolean>>;
  /** Why an app is paused. */
  pauseMessages: Partial<Record<AppKey, string>>;
}

/** Before update 9 (or when the server can't say): everything as it always was. */
export const DEFAULT_RULES: SignInRules = {
  signups: 'open',
  twoStep: 'optional',
  twoStepRequired: false,
  offlineDays: DEFAULT_OFFLINE_DAYS,
  plannerMakers: 'lumora',
  canMakePlans: null,
  waitingMessage: '',
  features: {},
  pauseMessages: {},
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** The server's answer (or a remembered one), made safe: anything odd falls back to the usual. */
export function rulesFrom(raw: unknown): SignInRules {
  if (!raw || typeof raw !== 'object') return DEFAULT_RULES;
  const r = raw as Record<string, unknown>;
  const days = Number(r.offline_days ?? r.offlineDays);
  const features: Partial<Record<FeatureKey, boolean>> = {};
  const f = r.features;
  if (f && typeof f === 'object')
    for (const [k, v] of Object.entries(f as Record<string, unknown>))
      if (typeof v === 'boolean' && ALL_FEATURES.some((x) => x.key === k)) features[k as FeatureKey] = v;
  const pauseMessages: Partial<Record<AppKey, string>> = {};
  const pm = r.pause_messages ?? r.pauseMessages;
  if (pm && typeof pm === 'object')
    for (const [k, v] of Object.entries(pm as Record<string, unknown>))
      if (typeof v === 'string' && (k === 'lumora' || k === 'studio' || k === 'planner')) pauseMessages[k] = v.slice(0, 300);
  const canMake = r.can_make_plans ?? r.canMakePlans;
  const waiting = r.waiting_message ?? r.waitingMessage;
  return {
    signups: pick(r.signups, ['open', 'closed'], 'open'),
    twoStep: pick(r.two_step ?? r.twoStep, ['optional', 'team', 'everyone'], 'optional'),
    twoStepRequired: (r.two_step_required ?? r.twoStepRequired) === true,
    offlineDays: (OFFLINE_CHOICES as readonly number[]).includes(days) ? days : DEFAULT_OFFLINE_DAYS,
    plannerMakers: pick(r.planner_makers ?? r.plannerMakers, ['lumora', 'anyone'], 'lumora'),
    canMakePlans: typeof canMake === 'boolean' ? canMake : null,
    waitingMessage: typeof waiting === 'string' ? waiting.slice(0, 500) : '',
    features,
    pauseMessages,
  };
}

/** Is this switch on (as the server worked it out for this account)? Missing rules or switches: on. */
export function featureOn(rules: SignInRules | null | undefined, key: FeatureKey): boolean {
  return rules?.features[key] !== false;
}

/**
 * The same rule the server uses (feature_on): a person's own setting wins
 * over the one for everyone; otherwise on. A paused app stays open for the
 * Lumora team. (For showing the Lumora team what someone gets.)
 */
export function effectiveFeature(key: FeatureKey, everyone: Partial<Record<string, boolean>>, own: boolean | null | undefined, admin = false): boolean {
  if (admin && (key === 'lumora' || key === 'studio' || key === 'planner')) return true;
  if (typeof own === 'boolean') return own;
  return everyone[key] !== false;
}

/** Features that were on and are now off (for the note while the app is open). */
export function turnedOff(before: SignInRules | null | undefined, after: SignInRules | null | undefined): FeatureKey[] {
  if (!after) return [];
  return FEATURES.map((f) => f.key).filter((k) => featureOn(before, k) && !featureOn(after, k));
}

/** Keep a feature that is in use: switching it off waits until it is no longer in use (or the next start). */
export function keepWhileInUse(on: boolean, inUse: boolean, wasOn: boolean): boolean {
  return on || (inUse && wasOn);
}
