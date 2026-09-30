import { describe, expect, it } from 'vitest';
import { defaultScripture, fitSize, plain, reference, shownVerses, tehillimForDay, tehillimForWeekday } from './tanach';

describe('Tanach', () => {
  it('knows the daily Tehillim', () => {
    expect(tehillimForDay(1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tehillimForDay(25)).toEqual([119]);
    expect(tehillimForDay(30)).toEqual([145, 146, 147, 148, 149, 150]);
    expect(tehillimForWeekday(6)).toEqual(Array.from({ length: 31 }, (_, i) => 120 + i));
    const all = Array.from({ length: 30 }, (_, i) => tehillimForDay(i + 1)).flat();
    expect(new Set(all).size).toBe(150);
  });
  it('shows verses and where they are from', () => {
    const t = { he: [['א', 'ב', 'ג']], en: [['one', 'two', 'three']] };
    const s = { ...defaultScripture(), book: 26, chapter: 1, from: 2, to: 3, current: 2 };
    expect(shownVerses(s, t)).toEqual([[2, 'ב', 'two']]);
    expect(shownVerses({ ...s, whole: true }, t).length).toBe(2);
    expect(shownVerses({ ...s, blank: true }, t)).toEqual([]);
    expect(reference({ ...s, chapter: 23, current: 1 }, 'תהילים')).toEqual({ en: 'Tehillim 23:1', he: 'תהילים כ״ג:א׳' });
    expect(plain('בְּרֵאשִׁית בָּרָא')).toBe('בראשית ברא');
    expect(fitSize(10, 160, 40, 7)).toBe(7);
    expect(fitSize(2000, 160, 40, 7)).toBeLessThan(3);
  });
});
