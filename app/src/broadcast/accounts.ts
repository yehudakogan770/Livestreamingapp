// Connected YouTube and Facebook accounts: going live without copying a
// stream key. The sign-in, the tokens and every call to YouTube and Facebook
// happen in Lumora itself (src-tauri/src/accounts.rs, crates/live-accounts);
// this window only sees names, broadcasts and health. See docs/LIVE_ACCOUNTS.md.

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { isInsideLumora, type CaptureSettings, type Destination } from '../engine/client';

export type Provider = 'youtube' | 'facebook';
export type Privacy = 'public' | 'unlisted' | 'private';
export type Latency = 'normal' | 'low' | 'ultraLow';

/** A new YouTube broadcast's settings. */
export interface BroadcastSettings {
  title: string;
  description: string;
  privacy: Privacy;
  /** RFC 3339 (UTC); empty: when Lumora goes live. */
  scheduledStart: string;
  /** Required by YouTube: is it made for kids? */
  madeForKids: boolean;
  /** The operator answered that question. */
  kidsChosen: boolean;
  latency: Latency;
  /** Viewers can rewind while it's live. */
  dvr: boolean;
  /** YouTube goes live by itself when the stream arrives. */
  autoStart: boolean;
  /** YouTube ends it by itself when the stream stops. */
  autoStop: boolean;
}

export interface YoutubeLink {
  provider: 'youtube';
  /** A broadcast made ahead of time; empty: a new one each time Lumora goes live. */
  broadcastId: string;
  settings: BroadcastSettings;
  /** A picture file for a new broadcast's thumbnail (empty: none). */
  thumbnail: string;
}

export type FbPrivacy = 'everyone' | 'friends' | 'onlyMe';

export interface FacebookLink {
  provider: 'facebook';
  /** A Page id, or "me". */
  targetId: string;
  targetName: string;
  settings: { title: string; description: string; privacy: FbPrivacy };
}

export type AccountLink = YoutubeLink | FacebookLink;

export interface ProviderInfo {
  /** This copy of Lumora has the app registration (docs/LIVE_ACCOUNTS.md). */
  setUp: boolean;
  connected: boolean;
  name: string;
  /** When the connection runs out (seconds since 1970; 0: it doesn't). */
  expiresAt: number;
}

export interface AccountsInfo {
  youtube: ProviderInfo;
  facebook: ProviderInfo;
}

export type Phase = 'created' | 'ready' | 'testing' | 'live' | 'complete' | 'revoked';
export type Health = 'good' | 'ok' | 'bad' | 'noData';

export interface Broadcast {
  id: string;
  title: string;
  description: string;
  privacy: Privacy;
  scheduledStart: string;
  lifeCycle: string;
  phase: Phase;
  boundStreamId: string | null;
  autoStart: boolean;
  autoStop: boolean;
  monitor: boolean;
  madeForKids: boolean;
  latency: Latency;
  dvr: boolean;
  watchUrl: string;
  thumbnailUrl: string | null;
}

/** A Facebook Page (or the person's own profile, "me"). */
export interface Target {
  id: string;
  name: string;
  canPublish: boolean;
}

/** How a connected destination is doing. */
export interface SessionView {
  destId: string;
  provider: Provider;
  phase: Phase;
  health: Health;
  watchUrl: string;
  title: string;
  message: string | null;
  issues: string[];
}

export interface Failed {
  destId: string;
  provider: Provider;
  error: { message: string; reconnect: boolean };
}

const NOT_HERE: ProviderInfo = { setUp: false, connected: false, name: '', expiresAt: 0 };

function needsApp(): never {
  throw new Error('Connected accounts work in the Windows app.');
}

/** Lumora's side of the connected accounts. */
export const accounts = {
  info: (): Promise<AccountsInfo> => (isInsideLumora() ? invoke<AccountsInfo>('accounts_info') : Promise.resolve({ youtube: NOT_HERE, facebook: NOT_HERE })),
  /** Opens the browser and waits (up to 5 minutes) for the sign-in. */
  connect: (provider: Provider): Promise<AccountsInfo> => (isInsideLumora() ? invoke<AccountsInfo>('accounts_connect', { provider }) : needsApp()),
  cancel: (): Promise<void> => (isInsideLumora() ? invoke<void>('accounts_cancel') : Promise.resolve()),
  /** Facebook's manual sign-in: opens the browser; the address it ends on is pasted back. */
  facebookManual: (): Promise<string> => (isInsideLumora() ? invoke<string>('accounts_facebook_manual') : needsApp()),
  facebookPaste: (address: string): Promise<AccountsInfo> => (isInsideLumora() ? invoke<AccountsInfo>('accounts_facebook_paste', { address }) : needsApp()),
  disconnect: (provider: Provider): Promise<AccountsInfo> => (isInsideLumora() ? invoke<AccountsInfo>('accounts_disconnect', { provider }) : needsApp()),
  broadcasts: (): Promise<Broadcast[]> => (isInsideLumora() ? invoke<Broadcast[]>('accounts_youtube_broadcasts') : Promise.resolve([])),
  createBroadcast: (settings: BroadcastSettings): Promise<Broadcast> =>
    isInsideLumora() ? invoke<Broadcast>('accounts_youtube_create', { settings }) : needsApp(),
  thumbnail: (broadcastId: string, path: string): Promise<void> =>
    isInsideLumora() ? invoke<void>('accounts_youtube_thumbnail', { broadcastId, path }) : needsApp(),
  /** Keep a picture (JPEG or PNG) with Lumora's files; resolves its path. */
  saveThumbnail: async (picture: Blob): Promise<string> =>
    isInsideLumora() ? invoke<string>('accounts_save_thumbnail', new Uint8Array(await picture.arrayBuffer())) : needsApp(),
  targets: (): Promise<Target[]> => (isInsideLumora() ? invoke<Target[]>('accounts_facebook_targets') : Promise.resolve([])),
  /** Before going live: each connected destination gets its broadcast, address and key. */
  prepare: (): Promise<{ ready: number; failed: Failed[] }> =>
    isInsideLumora() ? invoke<{ ready: number; failed: Failed[] }>('accounts_prepare') : Promise.resolve({ ready: 0, failed: [] }),
  /** After the operator stops: complete the broadcasts, end the live videos. */
  finish: (): Promise<Failed[]> => (isInsideLumora() ? invoke<Failed[]>('accounts_finish') : Promise.resolve([])),
  sessions: (): Promise<SessionView[]> => (isInsideLumora() ? invoke<SessionView[]>('accounts_sessions') : Promise.resolve([])),
};

export const PROVIDER_NAMES: Record<Provider, string> = { youtube: 'YouTube', facebook: 'Facebook' };

export function defaultBroadcastSettings(title = ''): BroadcastSettings {
  return {
    title,
    description: '',
    privacy: 'unlisted',
    scheduledStart: '',
    madeForKids: false,
    kidsChosen: false,
    latency: 'normal',
    dvr: true,
    autoStart: false,
    autoStop: false,
  };
}

/** A new destination going through a connected account. */
export function accountDestination(provider: Provider, title: string, id = `dest-${Date.now().toString(36)}`): Destination {
  const account: AccountLink =
    provider === 'youtube'
      ? { provider, broadcastId: '', settings: defaultBroadcastSettings(title), thumbnail: '' }
      : { provider, targetId: '', targetName: '', settings: { title, description: '', privacy: 'everyone' } };
  return { id, name: `${PROVIDER_NAMES[provider]} (account)`, url: '', key: '', enabled: true, vertical: false, account };
}

/** Some enabled destination goes through a connected account. */
export function usesAccounts(settings: CaptureSettings): boolean {
  return settings.destinations.some((d) => d.enabled && d.account);
}

/** What still has to be chosen before this destination can go live (null: ready). */
export function linkProblem(link: AccountLink, info: AccountsInfo): string | null {
  const p = info[link.provider];
  const name = PROVIDER_NAMES[link.provider];
  if (!p.setUp) return `Connecting a ${name} account isn’t set up in this copy of Lumora yet.`;
  if (!p.connected) return `Connect the ${name} account.`;
  if (link.provider === 'facebook') return link.targetId ? null : 'Choose the Page to go live on.';
  if (!link.broadcastId) {
    if (!link.settings.kidsChosen) return 'Choose whether the broadcast is made for kids (YouTube requires it).';
    if (link.settings.title.trim().length > 100) return 'The title is too long (100 characters at most).';
  }
  return null;
}

/** A connection that runs out (Facebook) within this many seconds is worth a warning. */
export function expiresSoon(p: ProviderInfo, nowS = Date.now() / 1000, withinS = 30 * 60): boolean {
  return p.connected && p.expiresAt > 0 && p.expiresAt - nowS < withinS;
}

export const HEALTH_WORDS: Record<Health, string> = {
  good: 'Good',
  ok: 'OK',
  bad: 'Poor',
  noData: 'No signal yet',
};

export const PHASE_WORDS: Record<Phase, string> = {
  created: 'Getting ready',
  ready: 'Ready — waiting for the stream',
  testing: 'Testing (only you can see it)',
  live: 'Live',
  complete: 'Ended',
  revoked: 'Removed',
};

/** "2026-10-08T18:30:00Z" ↔ the value of a datetime-local field (this computer's time). */
export function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The connected destinations' state, read every few seconds while `active`. */
export function useAccountSessions(active: boolean, everyMs = 5000): SessionView[] {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void accounts.sessions().then(
        (s) => alive && setSessions(s),
        () => {},
      );
    read();
    if (!active) return () => void (alive = false);
    const id = setInterval(read, everyMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active, everyMs]);
  return sessions;
}

/** A picture of the Live Screen for a thumbnail: 1280 × 720 JPEG (YouTube takes up to 2 MB). */
export async function thumbnailFrom(png: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The picture could not be made.');
  ctx.drawImage(bitmap, 0, 0, 1280, 720);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/jpeg', 0.88),
  );
}
