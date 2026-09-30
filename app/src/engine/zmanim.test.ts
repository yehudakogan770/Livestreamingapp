import { describe, expect, it } from 'vitest';
import { candlesTonight, formatHebrew, formatHebrewHe, gematria, hebrewOf, isYomTov, specialDay } from './hebcal';
import { sunOn } from './sun';

describe('Hebrew calendar', () => {
  it('knows the Hebrew date', () => {
    expect(formatHebrew(hebrewOf(2026, 9, 12))).toBe('1 Tishrei 5787');
    expect(formatHebrew(hebrewOf(2025, 4, 13))).toBe('15 Nisan 5785');
    expect(formatHebrew(hebrewOf(2024, 12, 26))).toBe('25 Kislev 5785');
    expect(formatHebrew(hebrewOf(2024, 3, 24))).toBe('14 Adar II 5784');
    expect(formatHebrew(hebrewOf(2000, 1, 1))).toBe('23 Tevet 5760');
    expect(formatHebrewHe(hebrewOf(2026, 9, 11))).toBe('כ״ט אלול תשפ״ו');
    expect(gematria(15)).toBe('ט״ו');
    expect(gematria(5)).toBe('ה׳');
  });
  it('knows Yom Tov and candle lighting', () => {
    expect(isYomTov(hebrewOf(2025, 4, 14), false)).toBe(true); // 16 Nisan, second day
    expect(isYomTov(hebrewOf(2025, 4, 14), true)).toBe(false);
    expect(candlesTonight(new Date(2026, 8, 25, 12), false)).toBe(true); // a Friday
    expect(candlesTonight(new Date(2026, 8, 24, 12), false)).toBe(false); // Thursday
    expect(candlesTonight(new Date(2026, 8, 11, 12), false)).toBe(true); // erev Rosh Hashanah
    expect(candlesTonight(new Date(2026, 8, 12, 12), false)).toBe(false); // first day: lit from a flame after nightfall
    expect(specialDay(hebrewOf(2024, 12, 27), false, 5)).toContain('Chanukah · day 2');
  });
});

describe('sun', () => {
  it('sets when it should', () => {
    // New York, 21 June 2025: sunset about 20:31 EDT (00:31 UTC).
    const set = sunOn(2025, 6, 21, 40.7128, -74.006).at(0.833)!.set;
    const utc = new Date(set);
    expect(utc.getUTCHours() * 60 + utc.getUTCMinutes()).toBeGreaterThanOrEqual(29);
    expect(utc.getUTCHours() * 60 + utc.getUTCMinutes()).toBeLessThanOrEqual(33);
    // Jerusalem, 1 January 2025: sunset about 16:45 IST (14:45 UTC).
    const j = new Date(sunOn(2025, 1, 1, 31.7683, 35.2137).at(0.833)!.set);
    expect(Math.abs(j.getUTCHours() * 60 + j.getUTCMinutes() - (14 * 60 + 45))).toBeLessThanOrEqual(3);
  });
});
