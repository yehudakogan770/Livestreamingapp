import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Destination, EngineClient } from '../engine/client';
import { AccountDestination, SessionBadge } from './AccountDestination';
import { accountDestination, type AccountsInfo, type Broadcast, type YoutubeLink } from './accounts';

const fake = vi.hoisted(() => ({
  connect: vi.fn(),
  cancel: vi.fn(async () => {}),
  broadcasts: vi.fn(),
  createBroadcast: vi.fn(),
  targets: vi.fn(),
  disconnect: vi.fn(),
  facebookManual: vi.fn(async () => 'https://www.facebook.com/v21.0/dialog/oauth?x'),
  facebookPaste: vi.fn(),
  thumbnail: vi.fn(async () => {}),
}));
vi.mock('./accounts', async (original) => ({ ...(await original<typeof import('./accounts')>()), accounts: fake }));

const client = {} as EngineClient;
const off = { setUp: false, connected: false, name: '', expiresAt: 0 };
const on = { setUp: true, connected: true, name: 'Riverside Community Hall', expiresAt: 0 };

const upcoming: Broadcast = {
  id: 'Xq9hFm3kLw0',
  title: 'Sunday morning service',
  description: '',
  privacy: 'unlisted',
  scheduledStart: '2026-10-11T14:00:00Z',
  lifeCycle: 'ready',
  phase: 'ready',
  boundStreamId: 'Abc',
  autoStart: false,
  autoStop: false,
  monitor: true,
  madeForKids: false,
  latency: 'low',
  dvr: true,
  watchUrl: 'https://www.youtube.com/watch?v=Xq9hFm3kLw0',
  thumbnailUrl: null,
};

function show(dest: Destination, info: AccountsInfo, onChange = vi.fn(), setInfo = vi.fn()) {
  render(<AccountDestination dest={dest} info={info} setInfo={setInfo} session={undefined} client={client} onChange={onChange} onRemove={() => {}} />);
  return { onChange, setInfo };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.broadcasts.mockResolvedValue([upcoming]);
  fake.targets.mockResolvedValue([
    { id: '112233445566778', name: 'Riverside Community Hall', canPublish: true },
    { id: '998877665544332', name: 'Weekend Band', canPublish: false },
  ]);
});

describe('a destination through a connected account', () => {
  it('says when this copy of Lumora isn’t set up for it', () => {
    show(accountDestination('youtube', ''), { youtube: off, facebook: off });
    expect(screen.getByText(/isn’t set up in this copy of Lumora yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect YouTube account' })).toBeNull();
  });

  it('connects through the browser and shows the account', async () => {
    const connected = { youtube: on, facebook: off };
    let signedIn: (i: AccountsInfo) => void = () => {};
    fake.connect.mockReturnValue(new Promise<AccountsInfo>((r) => (signedIn = r)));
    const { setInfo } = show(accountDestination('youtube', ''), { youtube: { ...off, setUp: true }, facebook: off });
    fireEvent.click(screen.getByRole('button', { name: 'Connect YouTube account' }));
    expect(await screen.findByText('Finish signing in in the browser…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fake.cancel).toHaveBeenCalled();
    signedIn(connected);
    await waitFor(() => expect(setInfo).toHaveBeenCalledWith(connected));
    expect(fake.connect).toHaveBeenCalledWith('youtube');
  });

  it('shows a failed sign-in in plain words', async () => {
    fake.connect.mockRejectedValue('The YouTube connection was canceled in the browser. Nothing was changed.');
    show(accountDestination('youtube', ''), { youtube: { ...off, setUp: true }, facebook: off });
    fireEvent.click(screen.getByRole('button', { name: 'Connect YouTube account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('canceled in the browser');
  });

  it('lists YouTube broadcasts and asks the made-for-kids question for a new one', async () => {
    const dest = accountDestination('youtube', 'Concert');
    const { onChange } = show(dest, { youtube: on, facebook: off });
    expect(screen.getByText('Riverside Community Hall')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /Sunday morning service/ })).toBeInTheDocument();
    expect(screen.getByText(/Choose whether the broadcast is made for kids/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /No, it’s not made for kids/ }));
    expect((onChange.mock.calls[0]![0].account as YoutubeLink).settings).toMatchObject({ kidsChosen: true, madeForKids: false });
    fireEvent.change(screen.getByRole('combobox', { name: 'YouTube broadcast' }), { target: { value: 'Xq9hFm3kLw0' } });
    expect((onChange.mock.calls[1]![0].account as YoutubeLink).broadcastId).toBe('Xq9hFm3kLw0');
  });

  it('shows a chosen broadcast’s watch link', async () => {
    const dest = accountDestination('youtube', '');
    (dest.account as YoutubeLink).broadcastId = 'Xq9hFm3kLw0';
    show(dest, { youtube: on, facebook: off });
    expect(await screen.findByRole('textbox', { name: 'Watch link' })).toHaveValue('https://www.youtube.com/watch?v=Xq9hFm3kLw0');
    expect(screen.queryByRole('radio', { name: /made for kids/ })).toBeNull();
  });

  it('lists the Facebook Pages that can go live', async () => {
    const { onChange } = show(accountDestination('facebook', ''), { youtube: off, facebook: { ...on, name: 'Alex Rivera' } });
    const band = await screen.findByRole('option', { name: /Weekend Band/ });
    expect(band).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Facebook Page' }), { target: { value: '112233445566778' } });
    expect(onChange.mock.calls[0]![0].account).toMatchObject({ targetId: '112233445566778', targetName: 'Riverside Community Hall' });
  });

  it('offers Facebook’s paste-the-address sign-in', async () => {
    fake.facebookPaste.mockResolvedValue({ youtube: off, facebook: on });
    const { setInfo } = show(accountDestination('facebook', ''), { youtube: off, facebook: { ...off, setUp: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect by pasting the address' }));
    const box = await screen.findByRole('textbox', { name: 'Address Facebook ended on' });
    fireEvent.change(box, { target: { value: 'https://www.facebook.com/connect/login_success.html#access_token=x&state=s' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(setInfo).toHaveBeenCalled());
    expect(fake.facebookPaste).toHaveBeenCalledWith(expect.stringContaining('access_token=x'));
  });
});

describe('the state of a connected broadcast', () => {
  it('shows where it is, the signal and the watch link', () => {
    render(
      <SessionBadge
        session={{
          destId: 'd',
          provider: 'youtube',
          phase: 'live',
          health: 'bad',
          watchUrl: 'https://www.youtube.com/watch?v=New0Broadcast1',
          title: 'Concert',
          message: null,
          issues: ['The current bitrate (1500 Kbps) is lower than the recommended bitrate.'],
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Live · Signal: Poor');
    expect(screen.getByText(/lower than the recommended bitrate/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Watch link' })).toHaveValue('https://www.youtube.com/watch?v=New0Broadcast1');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});
