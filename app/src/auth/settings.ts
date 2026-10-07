// For the Lumora team: the sign-in settings, features, invitations and the
// record of changes (supabase/update-9-sign-in-settings.sql). The server
// checks that the asker is on the Lumora team and keeps who changed what.

import { supabase, missingFunction } from './auth';
import { featureLabel, OFFLINE_CHOICES } from './rules';

export interface SettingsRow {
  approval: 'manual' | 'auto';
  auto_lumora: boolean;
  auto_studio: boolean;
  auto_domains: string[];
  signups: 'open' | 'closed';
  two_step: 'optional' | 'team' | 'everyone';
  offline_days: number;
  planner_makers: 'lumora' | 'anyone';
  waiting_message: string;
  features: Record<string, boolean>;
  pause_messages: Record<string, string>;
  updated_at?: string | null;
  updated_by_name?: string;
}

export type SettingsChange = Partial<Omit<SettingsRow, 'updated_at' | 'updated_by_name'>>;

export interface Invite {
  email: string;
  lumora: boolean;
  studio: boolean;
  invited_by_name: string;
  created_at: string;
}

export interface Override {
  user_id: string;
  feature: string;
  enabled: boolean;
}

export interface LogEntry {
  id: number;
  at: string;
  by_name: string;
  setting: string;
  person_email: string;
  old_value: unknown;
  new_value: unknown;
}

export interface AdminSettings {
  settings: SettingsRow;
  invites: Invite[];
  overrides: Override[];
  log: LogEntry[];
}

export const DEFAULT_SETTINGS: SettingsRow = {
  approval: 'manual',
  auto_lumora: true,
  auto_studio: true,
  auto_domains: [],
  signups: 'open',
  two_step: 'optional',
  offline_days: 7,
  planner_makers: 'lumora',
  waiting_message: '',
  features: {},
  pause_messages: {},
};

const say = (e: unknown): Error => {
  if (missingFunction(e))
    return new Error('These settings need the latest update on the Lumora account server: run supabase/update-9-sign-in-settings.sql in Supabase.');
  const m = e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/fetch|network|failed to/i.test(m)) return new Error('Lumora cannot reach the internet. Check the connection and try again.');
  return new Error(m);
};

export function adminSettingsFrom(raw: unknown): AdminSettings {
  const r = (raw ?? {}) as Partial<AdminSettings>;
  return {
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    invites: Array.isArray(r.invites) ? r.invites : [],
    overrides: Array.isArray(r.overrides) ? r.overrides : [],
    log: Array.isArray(r.log) ? r.log : [],
  };
}

export async function loadAdminSettings(): Promise<AdminSettings> {
  const { data, error } = await supabase().rpc('admin_app_settings');
  if (error) throw say(error);
  return adminSettingsFrom(data);
}

/** Save only what changed. Returns everything, as now saved. */
export async function saveSettings(change: SettingsChange): Promise<AdminSettings> {
  const { data, error } = await supabase().rpc('save_app_settings', { p: change });
  if (error) throw say(error);
  return adminSettingsFrom(data);
}

/** One person: a feature on or off just for them (null: as for everyone). */
export async function setOverride(userId: string, feature: string, enabled: boolean | null): Promise<void> {
  const { error } = await supabase().rpc('set_feature_override', { p_user: userId, p_feature: feature, p_enabled: enabled });
  if (error) throw say(error);
}

/** Invite an email: approved with these apps once they make their account (an existing account at once). */
export async function inviteByEmail(email: string, lumora: boolean, studio: boolean): Promise<{ pending: boolean }> {
  const { data, error } = await supabase().rpc('invite_to_lumora', { p_email: email, p_lumora: lumora, p_studio: studio });
  if (error) throw say(error);
  return { pending: (data as { pending?: unknown } | null)?.pending === true };
}

export async function cancelInvite(email: string): Promise<void> {
  const { error } = await supabase().from('app_invites').delete().eq('email', email);
  if (error) throw say(error);
}

// ---- Plain words for settings and changes ----

export const SETTING_NAMES: Record<string, string> = {
  approval: 'New accounts',
  auto_lumora: 'Apps for new accounts: Lumora',
  auto_studio: 'Apps for new accounts: Studio',
  auto_domains: 'Approve automatically only from',
  signups: 'New sign-ups',
  two_step: 'Two-step sign-in',
  offline_days: 'Offline use',
  planner_makers: 'Who can make plans',
  waiting_message: 'Waiting message',
};

export function valueWords(setting: string, v: unknown): string {
  if (v === null || v === undefined) return setting.startsWith('person.') ? 'as for everyone' : 'not set';
  const base = setting.split('.')[0];
  if (base === 'features' || base === 'person') return v === true ? 'on' : 'off';
  if (base === 'pause_messages') return v === '' ? 'no message' : `“${String(v)}”`;
  switch (setting) {
    case 'approval':
      return v === 'auto' ? 'Approve automatically' : 'Need my approval';
    case 'signups':
      return v === 'closed' ? 'Closed' : 'Open';
    case 'two_step':
      return v === 'everyone' ? 'Required for everyone' : v === 'team' ? 'Required for the Lumora team' : 'Optional for everyone';
    case 'offline_days':
      return `${String(v)} ${v === 1 ? 'day' : 'days'}`;
    case 'planner_makers':
      return v === 'anyone' ? 'Any account' : 'Approved Lumora accounts';
    case 'auto_domains':
      return Array.isArray(v) && v.length ? v.join(', ') : 'any email';
    case 'waiting_message':
      return v === '' ? 'the usual words' : `“${String(v)}”`;
    default:
      return typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v);
  }
}

/** One change, in a sentence: “Ann changed New sign-ups from Open to Closed”. */
export function describeChange(e: LogEntry): string {
  const who = e.by_name || 'Someone';
  const [base, sub = ''] = e.setting.split('.');
  if (e.setting === 'invite_used') return `${e.person_email} made an account with an invitation and was approved`;
  if (e.setting === 'auto_approved') return `${e.person_email} was approved automatically`;
  if (e.setting === 'invite') {
    const v = (e.new_value ?? {}) as { lumora?: boolean; studio?: boolean; pending?: boolean };
    const apps = [v.lumora && 'Lumora', v.studio && 'Studio'].filter(Boolean).join(' and ');
    return `${who} invited ${e.person_email} (${apps})${v.pending ? '' : ' — approved at once'}`;
  }
  if (base === 'person') return `${who} set ${featureLabel(sub)} for ${e.person_email}: ${valueWords(e.setting, e.new_value)}`;
  if (base === 'features') return `${who} turned ${featureLabel(sub)} ${valueWords(e.setting, e.new_value)} for everyone`;
  if (base === 'pause_messages') return `${who} changed the pause message for ${featureLabel(sub)} to ${valueWords(e.setting, e.new_value)}`;
  return `${who} changed ${SETTING_NAMES[e.setting] ?? e.setting} from ${valueWords(e.setting, e.old_value)} to ${valueWords(e.setting, e.new_value)}`;
}

export const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** A domain list as typed (commas, spaces or lines) → clean domains. */
export function parseDomains(text: string): string[] {
  const out: string[] = [];
  for (const d of text.split(/[\s,;]+/)) {
    const clean = d.trim().toLowerCase().replace(/^@/, '');
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

export const validDomain = (d: string): boolean => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d);

export const offlineChoices: readonly number[] = OFFLINE_CHOICES;
