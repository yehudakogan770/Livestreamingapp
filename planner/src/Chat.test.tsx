import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Chat } from './Chat';
import type { Message } from './chatModel';
import type { ChatStore } from './useChat';

const at = (min: number) => new Date(2026, 9, 6, 9, min).getTime();
const msg = (id: string, author: string, authorName: string, min: number, body: string): Message => ({
  id,
  planId: 'p',
  author,
  authorName,
  body,
  createdAt: at(min),
});
const messages = [
  msg('a', 'pat', 'Pat Lee', 0, 'Doors at 6'),
  msg('b', 'pat', 'Pat Lee', 1, 'Call time is 5'),
  msg('c', 'me', 'Alex Rivera', 2, 'Moving #2 earlier'),
  msg('d', 'sam', 'Sam Chen', 3, 'Works for me'),
];
const store = (over: Partial<ChatStore> = {}): ChatStore => ({
  messages,
  loaded: true,
  error: '',
  unread: 0,
  send: vi.fn(async () => {}),
  remove: vi.fn(),
  markRead: vi.fn(),
  ...over,
});

describe('chat thread', () => {
  it('reads like a messaging app: mine on the right, names once per run, no subject lines', () => {
    const { container } = render(<Chat chat={store()} me="me" isOwner={false} cueCount={5} onCue={() => {}} planName="Gala" />);
    const bubbles = [...container.querySelectorAll('.bub')];
    expect(bubbles.map((b) => b.className.replace(/\s+/g, ' '))).toEqual([
      'bub bub--theirs bub--first',
      'bub bub--theirs bub--last',
      'bub bub--mine bub--single',
      'bub bub--theirs bub--single',
    ]);
    // Pat's name and initials once for two messages; none on mine.
    expect(screen.getAllByText('Pat Lee')).toHaveLength(1);
    expect(screen.queryByText('Alex Rivera')).toBeNull();
    expect(screen.getByText('PL')).toBeInTheDocument();
    // A day divider, and the time once at the end of each run.
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(container.querySelectorAll('.bub__time')).toHaveLength(3);
    // Only my own message can be deleted (not the owner).
    expect(screen.getAllByRole('button', { name: 'Delete message' })).toHaveLength(1);
  });

  it('a tap on a message shows its time; #2 shows cue 2', () => {
    const onCue = vi.fn();
    const { container } = render(<Chat chat={store()} me="me" isOwner cueCount={5} onCue={onCue} planName="Gala" />);
    const first = container.querySelector('.bub')!;
    expect(first.querySelector('.bub__time')).toBeNull();
    fireEvent.click(screen.getByText('Doors at 6'));
    expect(first.querySelector('.bub__time')).not.toBeNull();
    expect(first).toHaveClass('is-picked');
    fireEvent.click(screen.getByRole('button', { name: '#2' }));
    expect(onCue).toHaveBeenCalledWith(2);
  });

  it('Enter sends, Shift+Enter does not', () => {
    const chat = store();
    render(<Chat chat={chat} me="me" isOwner={false} cueCount={5} onCue={() => {}} planName="Gala" />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'On my way' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(chat.send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(chat.send).toHaveBeenCalledWith('On my way', []);
  });
});
