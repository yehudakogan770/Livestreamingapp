import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { JoinApi, LinkStatus } from './api';
import { JoinDialog } from './JoinDialog';

function fakeApi() {
  let cb: ((s: LinkStatus) => void) | null = null;
  const api: JoinApi = {
    discover: vi.fn(() => Promise.resolve([{ id: 's1', name: 'Spring Gala (FOH-PC)', address: '192.168.1.20:8097' }])),
    computerName: vi.fn(() => Promise.resolve('LAPTOP-7')),
    saved: vi.fn(() => Promise.resolve([{ showId: 'old', show: 'Summer Fair (DESK)', address: '10.0.0.5:8097', name: 'LAPTOP-7' }])),
    join: vi.fn(() => Promise.resolve<LinkStatus>({ state: 'connecting', address: '192.168.1.20:8097' })),
    rejoin: vi.fn(() => Promise.resolve<LinkStatus>({ state: 'connecting', address: '10.0.0.5:8097' })),
    forget: vi.fn(() => Promise.resolve([])),
    code: vi.fn(() => Promise.resolve<LinkStatus>({ state: 'waiting', show: 'Spring Gala (FOH-PC)' })),
    openWindow: vi.fn(() => Promise.resolve()),
    leave: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => Promise.resolve<LinkStatus>({ state: 'idle' })),
    onStatus: (f) => {
      cb = f;
      return () => (cb = null);
    },
  };
  return { api, push: (s: LinkStatus) => act(() => cb?.(s)) };
}

describe('Join a show on this network', () => {
  it('finds shows and joins one with this computer’s name', async () => {
    const { api } = fakeApi();
    render(<JoinDialog api={api} onClose={() => {}} />);
    expect(await screen.findByText('Spring Gala (FOH-PC)')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('LAPTOP-7')).toBeInTheDocument();
    // The found show's Join (the typed-address one waits for an address).
    const [found, typed] = screen.getAllByRole('button', { name: 'Join' });
    expect(typed).toBeDisabled();
    fireEvent.click(found!);
    expect(api.join).toHaveBeenCalledWith('192.168.1.20:8097', 'LAPTOP-7');
  });

  it('joins by a typed address', async () => {
    const { api } = fakeApi();
    render(<JoinDialog api={api} onClose={() => {}} />);
    await screen.findByDisplayValue('LAPTOP-7');
    fireEvent.change(screen.getByPlaceholderText('192.168.1.20'), { target: { value: '10.1.1.9' } });
    fireEvent.keyDown(screen.getByPlaceholderText('192.168.1.20'), { key: 'Enter' });
    expect(api.join).toHaveBeenCalledWith('10.1.1.9', 'LAPTOP-7');
  });

  it('asks for the code, sends it once it is 6 digits, then waits and opens the seat window', async () => {
    const { api, push } = fakeApi();
    const close = vi.fn();
    render(<JoinDialog api={api} onClose={close} />);
    push({ state: 'enterCode', show: 'Spring Gala (FOH-PC)', wrong: false });
    const field = await screen.findByRole('textbox', { name: 'Code' });
    const join = screen.getByRole('button', { name: 'Join' });
    fireEvent.change(field, { target: { value: '482 91' } });
    expect(join).toBeDisabled();
    fireEvent.change(field, { target: { value: '482 913' } });
    fireEvent.click(join);
    expect(api.code).toHaveBeenCalledWith('482 913');
    push({ state: 'enterCode', show: 'Spring Gala (FOH-PC)', wrong: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('That isn’t the code on the show computer');
    push({ state: 'waiting', show: 'Spring Gala (FOH-PC)' });
    expect(await screen.findByText(/Waiting for the show operator/)).toBeInTheDocument();
    push({ state: 'connected', show: 'Spring Gala (FOH-PC)', seat: { id: 'x', name: 'LAPTOP-7', role: { kind: 'graphics' }, locked: false }, rttMs: 4 });
    await vi.waitFor(() => expect(api.openWindow).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('joins a show from before with no code, or forgets it', async () => {
    const { api } = fakeApi();
    render(<JoinDialog api={api} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join again' }));
    expect(api.rejoin).toHaveBeenCalledWith('old');
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    expect(api.forget).toHaveBeenCalledWith('old');
  });

  it('says why it ended, and cancelling leaves', async () => {
    const { api, push } = fakeApi();
    render(<JoinDialog api={api} onClose={() => {}} />);
    push({ state: 'ended', reason: 'The show operator said no.' });
    expect(await screen.findByRole('alert')).toHaveTextContent('The show operator said no.');
    push({ state: 'connecting', address: '192.168.1.20:8097' });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(api.leave).toHaveBeenCalled();
  });
});
