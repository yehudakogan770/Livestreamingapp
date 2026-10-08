import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OperatorsApi, SeatsStatus } from './api';
import { JoinRequestNote, OperatorsDialog } from './OperatorsDialog';

function status(over: Partial<SeatsStatus> = {}): SeatsStatus {
  return {
    enabled: true,
    running: true,
    port: 8097,
    addresses: ['192.168.1.20:8097'],
    error: null,
    show: 'Spring Gala (FOH-PC)',
    pending: [],
    seats: [],
    ...over,
  };
}

function fakeApi(start: SeatsStatus) {
  let cb: ((s: SeatsStatus) => void) | null = null;
  const ok = () => Promise.resolve(start);
  const api: OperatorsApi = {
    status: vi.fn(ok),
    setEnabled: vi.fn(ok),
    approve: vi.fn(ok),
    deny: vi.fn(ok),
    setRole: vi.fn(ok),
    setLocked: vi.fn(ok),
    remove: vi.fn(ok),
    watch: (f) => {
      cb = f;
      return () => (cb = null);
    },
  };
  return { api, push: (s: SeatsStatus) => act(() => cb?.(s)) };
}

const pending = { id: 7, name: 'Graphics laptop', address: '192.168.1.33', code: '482913', codeTyped: false, approved: false };
const seat = {
  id: 'abc',
  name: 'Audio desk',
  role: { kind: 'audio' as const },
  locked: false,
  connected: true,
  address: '192.168.1.40',
  latencyMs: 12,
  since: Date.now(),
};

describe('Operators (the show computer)', () => {
  it('says where others find the show and lets joining be turned off', async () => {
    const { api } = fakeApi(status());
    render(<OperatorsDialog api={api} onClose={() => {}} />);
    expect(await screen.findByText('192.168.1.20')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Let other computers join this show/ }));
    expect(api.setEnabled).toHaveBeenCalledWith(false);
  });

  it('shows the code for a waiting computer and lets it in with the chosen seat', async () => {
    const { api } = fakeApi(status({ pending: [pending] }));
    render(<OperatorsDialog api={api} onClose={() => {}} />);
    const req = await screen.findByTestId('seat-request');
    expect(within(req).getByTestId('seat-code')).toHaveTextContent('482 913');
    expect(within(req).getByText('Waiting for them to type it')).toBeInTheDocument();
    fireEvent.change(within(req).getByRole('combobox', { name: 'Seat for Graphics laptop' }), { target: { value: 'custom' } });
    // Custom starts from what the role had (Graphics): untick two, tick one.
    expect(within(req).getByRole('checkbox', { name: 'Overlays' })).toBeChecked();
    fireEvent.click(within(req).getByRole('checkbox', { name: 'Song lyrics' }));
    fireEvent.click(within(req).getByRole('checkbox', { name: 'Slideshows' }));
    fireEvent.click(within(req).getByRole('checkbox', { name: 'Instant replay' }));
    fireEvent.click(within(req).getByRole('button', { name: 'Let in' }));
    expect(api.approve).toHaveBeenCalledWith(7, { kind: 'custom', groups: ['overlays', 'titles', 'scoreboards', 'countdowns', 'data', 'replay'] });
  });

  it('says no', async () => {
    const { api } = fakeApi(status({ pending: [pending] }));
    render(<OperatorsDialog api={api} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Say no' }));
    expect(api.deny).toHaveBeenCalledWith(7);
  });

  it('lists seats with their role and delay, and changes, locks and removes them', async () => {
    const { api, push } = fakeApi(status({ seats: [seat] }));
    render(<OperatorsDialog api={api} onClose={() => {}} />);
    const row = await screen.findByTestId('seat-row');
    expect(within(row).getByText('Audio desk')).toBeInTheDocument();
    expect(within(row).getByText('12 ms')).toBeInTheDocument();
    fireEvent.change(within(row).getByRole('combobox', { name: 'Role of Audio desk' }), { target: { value: 'director' } });
    expect(api.setRole).toHaveBeenCalledWith('abc', { kind: 'director' });
    const lock = within(row).getByRole('button', { name: /Lock/ });
    await vi.waitFor(() => expect(lock).toBeEnabled());
    fireEvent.click(lock);
    expect(api.setLocked).toHaveBeenCalledWith('abc', true);
    const remove = within(row).getByRole('button', { name: /Remove/ });
    await vi.waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    expect(api.remove).toHaveBeenCalledWith('abc');
    // Updates arrive by themselves.
    push(status({ seats: [{ ...seat, connected: false, latencyMs: null }] }));
    expect(await screen.findByText('Not connected now')).toBeInTheDocument();
  });

  it('tells the show computer when someone asks to join', async () => {
    const { api, push } = fakeApi(status());
    const open = vi.fn();
    render(<JoinRequestNote api={api} onOpen={open} />);
    expect(screen.queryByRole('status')).toBeNull();
    push(status({ pending: [pending] }));
    expect(await screen.findByRole('status')).toHaveTextContent('Graphics laptop wants to join this show');
    fireEvent.click(screen.getByRole('button', { name: 'Operators…' }));
    expect(open).toHaveBeenCalled();
    push(status({ pending: [{ ...pending, approved: true }] }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
