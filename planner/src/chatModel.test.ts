import { describe, expect, it } from 'vitest';
import { addMessage, dayLabel, mayDelete, messageFromRow, parseMentions, startsGroup, unreadCount, type Message } from './chatModel';

const msg = (id: string, author: string, at: string, body = 'Hi'): Message => ({
  id,
  planId: 'p',
  author,
  authorName: author.toUpperCase(),
  body,
  createdAt: Date.parse(at),
});

describe('plan chat', () => {
  it('reads rows as stored', () => {
    const m = messageFromRow({ id: 'a', plan_id: 'p', author: 'u', author_name: 'Uri', body: 'Doors at 6', created_at: '2026-10-06T18:00:00Z' });
    expect(m).toEqual({ id: 'a', planId: 'p', author: 'u', authorName: 'Uri', body: 'Doors at 6', createdAt: Date.parse('2026-10-06T18:00:00Z') });
  });

  it('adds a message once, in time order (sent here, then heard back live)', () => {
    const a = msg('a', 'u', '2026-10-06T18:00:00Z');
    const b = msg('b', 'v', '2026-10-06T17:00:00Z');
    const list = addMessage(addMessage([a], b), a);
    expect(list.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('counts unread messages from others only', () => {
    const list = [msg('a', 'me', '2026-10-06T18:00:00Z'), msg('b', 'v', '2026-10-06T18:01:00Z'), msg('c', 'v', '2026-10-06T18:02:00Z')];
    expect(unreadCount(list, 'me', 0)).toBe(2);
    expect(unreadCount(list, 'me', Date.parse('2026-10-06T18:01:00Z'))).toBe(1);
  });

  it('lets the author or the owner delete', () => {
    const m = msg('a', 'u', '2026-10-06T18:00:00Z');
    expect(mayDelete(m, 'u', false)).toBe(true);
    expect(mayDelete(m, 'v', false)).toBe(false);
    expect(mayDelete(m, 'v', true)).toBe(true);
  });

  it('links #4 to cue 4 when there is one', () => {
    expect(parseMentions('Move #4 after #12, see #99', 20)).toEqual([
      { text: 'Move ' },
      { cue: 4, text: '#4' },
      { text: ' after ' },
      { cue: 12, text: '#12' },
      { text: ', see #99' },
    ]);
    expect(parseMentions('#1 first', 3)).toEqual([{ cue: 1, text: '#1' }, { text: ' first' }]);
    expect(parseMentions('a&#4;b and #0', 5)).toEqual([{ text: 'a&#4;b and #0' }]);
  });

  it('groups messages by author within five minutes', () => {
    const list = [
      msg('a', 'u', '2026-10-06T18:00:00Z'),
      msg('b', 'u', '2026-10-06T18:03:00Z'),
      msg('c', 'u', '2026-10-06T18:10:00Z'),
      msg('d', 'v', '2026-10-06T18:10:30Z'),
    ];
    expect(list.map((_, i) => startsGroup(list, i))).toEqual([true, false, true, true]);
  });

  it('names the day', () => {
    const now = new Date(2026, 9, 6, 20, 0);
    expect(dayLabel(new Date(2026, 9, 6, 9).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 5, 9).getTime(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 1, 9).getTime(), now)).toBe('Thu, Oct 1');
  });
});
