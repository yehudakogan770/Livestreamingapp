import { describe, expect, it } from 'vitest';
import { defaultCaptureSettings } from '../engine/client';
import {
  accountDestination,
  accounts,
  expiresSoon,
  fromLocalInput,
  linkProblem,
  toLocalInput,
  usesAccounts,
  type AccountsInfo,
  type YoutubeLink,
} from './accounts';

const info = (over: Partial<AccountsInfo['youtube']> = {}): AccountsInfo => ({
  youtube: { setUp: true, connected: true, name: 'Riverside Community Hall', expiresAt: 0, ...over },
  facebook: { setUp: true, connected: true, name: 'Alex', expiresAt: 0, ...over },
});

describe('connected-account destinations', () => {
  it('start with no address or key: Lumora fills them in at GO LIVE', () => {
    const d = accountDestination('youtube', 'Spring concert', 'd1');
    expect(d).toMatchObject({ id: 'd1', url: '', key: '', enabled: true, name: 'YouTube (account)' });
    expect(d.account).toMatchObject({ provider: 'youtube', broadcastId: '', thumbnail: '' });
    expect((d.account as YoutubeLink).settings).toMatchObject({ title: 'Spring concert', privacy: 'unlisted', kidsChosen: false, dvr: true });
    expect(accountDestination('facebook', 'x').account).toMatchObject({ provider: 'facebook', targetId: '' });
  });

  it('are noticed among the destinations only when switched on', () => {
    const s = defaultCaptureSettings();
    expect(usesAccounts(s)).toBe(false);
    const d = accountDestination('facebook', '');
    expect(usesAccounts({ ...s, destinations: [{ ...d, enabled: false }] })).toBe(false);
    expect(usesAccounts({ ...s, destinations: [d] })).toBe(true);
  });

  it('say what is still missing, YouTube’s made-for-kids answer included', () => {
    const yt = accountDestination('youtube', 'Concert').account as YoutubeLink;
    expect(linkProblem(yt, info({ setUp: false }))).toMatch(/isn’t set up in this copy of Lumora yet/);
    expect(linkProblem(yt, info({ connected: false }))).toBe('Connect the YouTube account.');
    expect(linkProblem(yt, info())).toMatch(/made for kids/);
    expect(linkProblem({ ...yt, settings: { ...yt.settings, kidsChosen: true } }, info())).toBeNull();
    // A broadcast made ahead already has its answers.
    expect(linkProblem({ ...yt, broadcastId: 'b1' }, info())).toBeNull();
    const fb = accountDestination('facebook', '').account!;
    expect(linkProblem(fb, info())).toBe('Choose the Page to go live on.');
  });

  it('warn when a Facebook connection runs out soon', () => {
    expect(expiresSoon({ setUp: true, connected: true, name: '', expiresAt: 0 }, 1000)).toBe(false);
    expect(expiresSoon({ setUp: true, connected: true, name: '', expiresAt: 1000 + 600 }, 1000)).toBe(true);
    expect(expiresSoon({ setUp: true, connected: true, name: '', expiresAt: 1000 + 7200 }, 1000)).toBe(false);
  });

  it('turn the scheduled start into this computer’s time and back', () => {
    expect(toLocalInput('')).toBe('');
    expect(fromLocalInput('')).toBe('');
    const iso = fromLocalInput('2026-10-11T10:00');
    expect(iso).toMatch(/^2026-10-1[01]T\d\d:00:00Z$/);
    expect(toLocalInput(iso)).toBe('2026-10-11T10:00');
  });

  it('do nothing outside the Windows app', async () => {
    expect((await accounts.info()).youtube.setUp).toBe(false);
    expect(await accounts.prepare()).toEqual({ ready: 0, failed: [] });
    expect(await accounts.finish()).toEqual([]);
    expect(() => accounts.connect('youtube')).toThrow(/Windows app/);
  });
});
