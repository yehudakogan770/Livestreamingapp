p='planner/src/chatModel.test.ts'
s=open(p).read()
s=s.replace("import { addMessage, dayLabel, mayDelete, messageFromRow, parseMentions, startsGroup, unreadCount, type Message } from './chatModel';",
"import { addMessage, dayLabel, endsGroup, mayDelete, messageFromRow, newFromOthers, parseMentions, runPos, startsGroup, threadRows, unreadCount, type Message } from './chatModel';")
old="""  it('names the day', () => {
    const now = new Date(2026, 9, 6, 20, 0);
    expect(dayLabel(new Date(2026, 9, 6, 9).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 5, 9).getTime(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 1, 9).getTime(), now)).toBe('Thu, Oct 1');
  });"""
new="""  it('names the day', () => {
    const now = new Date(2026, 9, 6, 20, 0);
    expect(dayLabel(new Date(2026, 9, 6, 9).getTime(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 5, 9).getTime(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 1, 9).getTime(), now)).toBe('Thu, Oct 1');
    expect(dayLabel(new Date(2025, 11, 30, 9).getTime(), now)).toBe('Tue, Dec 30, 2025');
    // Yesterday across the start of a month and a year.
    expect(dayLabel(new Date(2026, 11, 31, 23).getTime(), new Date(2027, 0, 1, 8))).toBe('Yesterday');
  });

  it('shapes runs of messages: first, middle, last, or one on its own', () => {
    const list = [
      msg('a', 'u', '2026-10-06T18:00:00Z'),
      msg('b', 'u', '2026-10-06T18:01:00Z'),
      msg('c', 'u', '2026-10-06T18:02:00Z'),
      msg('d', 'v', '2026-10-06T18:03:00Z'),
      msg('e', 'u', '2026-10-06T18:04:00Z'),
      msg('f', 'u', '2026-10-06T18:20:00Z'),
    ];
    expect(list.map((_, i) => runPos(list, i))).toEqual(['first', 'middle', 'last', 'single', 'single', 'single']);
    expect(list.map((_, i) => endsGroup(list, i))).toEqual([false, false, true, true, true, true]);
  });

  it('lays out the thread: day dividers, my messages apart, names and times once per run', () => {
    const now = new Date('2026-10-06T20:00:00');
    const list = [
      msg('a', 'pat', '2026-10-05T09:00:00'),
      msg('b', 'pat', '2026-10-05T09:02:00'),
      msg('c', 'me', '2026-10-05T09:03:00'),
      msg('d', 'pat', '2026-10-06T08:00:00'),
      msg('e', 'me', '2026-10-06T08:01:00'),
      msg('f', 'me', '2026-10-06T08:01:30'),
    ];
    const rows = threadRows(list, 'me', now);
    expect(rows.map((r) => (r.kind === 'day' ? r.label : `${r.m.id}:${r.mine ? 'mine' : 'theirs'}:${r.pos}:${r.head ? 'head' : ''}:${r.time ? 'time' : ''}`))).toEqual([
      'Yesterday',
      'a:theirs:first:head:',
      'b:theirs:last::time',
      'c:mine:single::time',
      'Today',
      'd:theirs:single:head:time',
      'e:mine:first::',
      'f:mine:last::time',
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(threadRows([], 'me', now)).toEqual([]);
  });

  it('counts the messages from others that came in while scrolled up', () => {
    const list = [msg('a', 'v', '2026-10-06T18:00:00Z'), msg('b', 'me', '2026-10-06T18:01:00Z'), msg('c', 'v', '2026-10-06T18:02:00Z'), msg('d', 'w', '2026-10-06T18:03:00Z')];
    expect(newFromOthers(list, 4, 'me')).toBe(0);
    expect(newFromOthers(list, 1, 'me')).toBe(2);
    expect(newFromOthers(list, 0, 'me')).toBe(3);
  });"""
assert old in s
s=s.replace(old,new)
open(p,'w').write(s)
