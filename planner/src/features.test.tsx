import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chat } from './Chat';
import { PlannerFeaturesCtx } from './features';
import type { ChatStore } from './useChat';

const chat: ChatStore = { messages: [], loaded: true, error: '', unread: 0, send: vi.fn(async () => {}), remove: vi.fn(), markRead: vi.fn() };
const show = (on: boolean) =>
  render(
    <PlannerFeaturesCtx.Provider value={{ chat: on, sharing: true }}>
      <Chat chat={chat} me="u" isOwner cueCount={0} onCue={() => {}} planName="Gala" />
    </PlannerFeaturesCtx.Provider>,
  );

afterEach(cleanup);

describe('the Lumora team’s Planner switches', () => {
  it('chat on: anyone on the plan can write', () => {
    show(true);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('chat off: the messages stay readable, and nobody can send', () => {
    show(false);
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('The Lumora team has turned off Planner chat for now.');
  });
});
