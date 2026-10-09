import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DemoClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { EventSetup } from './EventSetup';

async function setUp(patch: (s: Show) => Show = (s) => s) {
  const client = new DemoClient();
  let show = (await client.getShow()).show;
  show = patch({ ...show, sources: [], event: { ...show.event, setUp: false } });
  const sent: string[] = [];
  const dispatch = vi.spyOn(client, 'dispatch');
  dispatch.mockImplementation((a) => {
    sent.push(a.type);
    return Promise.resolve(undefined as never);
  });
  vi.spyOn(client, 'getShow').mockResolvedValue({ show, revision: 0 } as never);
  const onClose = vi.fn();
  render(<EventSetup show={show} client={client} onClose={onClose} onError={(e) => console.error(e)} />);
  return { sent, onClose };
}

describe('event setup', () => {
  it('a new event can start from a template, added when Done is pressed', async () => {
    const { sent, onClose } = await setUp();
    expect(screen.getByText('What kind of event?')).toBeInTheDocument();
    expect(screen.getByLabelText('Step 1 of 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Wedding/ }));
    expect(screen.getByRole('button', { name: /Wedding/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Adds: Ceremony countdown/)).toBeInTheDocument();
    expect(sent).toEqual([]);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent.filter((t) => t === 'addSource')).toHaveLength(6);
    expect(sent).toContain('setCues');
    expect(sent.indexOf('addSource')).toBeLessThan(sent.indexOf('updateEvent'));
  });

  it('starting empty, or an event that already has inputs, adds nothing', async () => {
    const { sent, onClose } = await setUp();
    fireEvent.click(screen.getByRole('button', { name: /Start empty/ }));
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).not.toContain('addSource');
  });

  it('is not offered again once the event has inputs', async () => {
    await setUp((s) => ({ ...s, sources: [{ id: 'cam', name: 'Cam', kind: { type: 'pattern' } } as never] }));
    expect(screen.queryByText('What kind of event?')).toBeNull();
    expect(screen.getByLabelText('Step 1 of 3')).toBeInTheDocument();
  });
});
