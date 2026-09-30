import { describe, expect, it } from 'vitest';
import { defaultSeating, pageAt, parseGuests, PER_PAGE } from './seating';

describe('table finder', () => {
  it('reads a pasted list or a CSV', () => {
    expect(parseGuests('Name,Table\nCohen, David, 12\nSarah Levi, 4\n\n"Katz family";7\nno table')).toEqual([
      { name: 'Cohen, David', table: '12' },
      { name: 'Sarah Levi', table: '4' },
      { name: 'Katz family', table: '7' },
    ]);
  });
  it('shows the list a page at a time', () => {
    const s = { ...defaultSeating(), seconds: 5, guests: Array.from({ length: PER_PAGE + 3 }, (_, i) => ({ name: `G${i}`, table: '1' })) };
    expect(pageAt(s, 0).guests.length).toBe(PER_PAGE);
    expect(pageAt(s, 5000)).toEqual({ page: 1, guests: s.guests.slice(PER_PAGE) });
    expect(pageAt(s, 10_000).page).toBe(0);
  });
});
