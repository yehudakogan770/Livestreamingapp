// The Hebrew calendar, worked out on the computer (the arithmetic of
// Reingold & Dershowitz, "Calendrical Calculations"): today's Hebrew date,
// Shabbos and Yom Tov, and the special days shown on screen.

/** Months: 1 Nisan … 6 Elul, 7 Tishrei … 12 Adar (Adar I in a leap year), 13 Adar II. */
export interface HDate {
  year: number;
  month: number;
  day: number;
}

const EPOCH = -1373427; // 1 Tishrei, year 1 (as a day count from 1 January, year 1)

export const isLeap = (y: number) => (7 * y + 1) % 19 < 7;

function elapsedDays(y: number): number {
  const months = Math.floor((235 * y - 234) / 19);
  const parts = 12084 + 13753 * months;
  const day = months * 29 + Math.floor(parts / 25920);
  return (3 * (day + 1)) % 7 < 3 ? day + 1 : day;
}

function delay(y: number): number {
  const ny0 = elapsedDays(y - 1);
  const ny1 = elapsedDays(y);
  const ny2 = elapsedDays(y + 1);
  if (ny2 - ny1 === 356) return 2;
  if (ny1 - ny0 === 382) return 1;
  return 0;
}

const newYear = (y: number) => EPOCH + elapsedDays(y) + delay(y);
const daysInYear = (y: number) => newYear(y + 1) - newYear(y);
const lastMonth = (y: number) => (isLeap(y) ? 13 : 12);

export function daysInMonth(m: number, y: number): number {
  if ([2, 4, 6, 10, 13].includes(m)) return 29;
  if (m === 12 && !isLeap(y)) return 29;
  if (m === 8 && daysInYear(y) % 10 !== 5) return 29;
  if (m === 9 && daysInYear(y) % 10 === 3) return 29;
  return 30;
}

/** Day count (1 January, year 1 = day 1) of a Hebrew date. */
export function fixedFromHebrew({ year, month, day }: HDate): number {
  let n = newYear(year) + day - 1;
  if (month < 7) {
    for (let m = 7; m <= lastMonth(year); m++) n += daysInMonth(m, year);
    for (let m = 1; m < month; m++) n += daysInMonth(m, year);
  } else {
    for (let m = 7; m < month; m++) n += daysInMonth(m, year);
  }
  return n;
}

export function hebrewFromFixed(date: number): HDate {
  const approx = Math.floor((date - EPOCH) / (35975351 / 98496)) + 1;
  // The year is the last one (from approx - 1) whose new year has come.
  let year = approx - 1;
  while (newYear(year + 1) <= date) year += 1;
  const start = date < fixedFromHebrew({ year, month: 1, day: 1 }) ? 7 : 1;
  let month = start;
  while (date > fixedFromHebrew({ year, month, day: daysInMonth(month, year) })) month = month === lastMonth(year) ? 1 : month + 1;
  return { year, month, day: date - fixedFromHebrew({ year, month, day: 1 }) + 1 };
}

/** Day count of a civil date (year, month 1–12, day). */
export const fixedFromCivil = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) + 719_163;

/** The Hebrew date of a civil date (the daytime: the Hebrew day began the evening before). */
export const hebrewOf = (y: number, m: number, d: number) => hebrewFromFixed(fixedFromCivil(y, m, d));

const MONTHS_EN = ['', 'Nisan', 'Iyar', 'Sivan', 'Tamuz', 'Av', 'Elul', 'Tishrei', 'Cheshvan', 'Kislev', 'Tevet', 'Shvat', 'Adar', 'Adar II'];
const MONTHS_HE = ['', 'ניסן', 'אייר', 'סיון', 'תמוז', 'אב', 'אלול', 'תשרי', 'חשון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר ב׳'];

export const monthName = (h: HDate) => (h.month === 12 && isLeap(h.year) ? 'Adar I' : MONTHS_EN[h.month]!);
export const monthNameHe = (h: HDate) => (h.month === 12 && isLeap(h.year) ? 'אדר א׳' : MONTHS_HE[h.month]!);

/** A number in Hebrew letters: 15 → ט״ו, 786 → תשפ״ו. */
export function gematria(n: number): string {
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const hundreds = ['', 'ק', 'ר', 'ש', 'ת'];
  let s = '';
  let x = n % 1000;
  while (x >= 400) {
    s += 'ת';
    x -= 400;
  }
  s += hundreds[Math.floor(x / 100)];
  x %= 100;
  if (x === 15) s += 'טו';
  else if (x === 16) s += 'טז';
  else s += tens[Math.floor(x / 10)]! + ones[x % 10]!;
  return s.length > 1 ? `${s.slice(0, -1)}״${s.slice(-1)}` : `${s}׳`;
}

/** "27 Elul 5786" */
export const formatHebrew = (h: HDate) => `${h.day} ${monthName(h)} ${h.year}`;
/** "כ״ז אלול תשפ״ו" */
export const formatHebrewHe = (h: HDate) => `${gematria(h.day)} ${monthNameHe(h)} ${gematria(h.year)}`;

/** A day of Yom Tov (no work: candles the evening before). */
export function isYomTov(h: HDate, israel: boolean): boolean {
  const { month: m, day: d } = h;
  const two = !israel;
  if (m === 1) return d === 15 || d === 21 || (two && (d === 16 || d === 22));
  if (m === 3) return d === 6 || (two && d === 7);
  if (m === 7) return d === 1 || d === 2 || d === 10 || d === 15 || d === 22 || (two && (d === 16 || d === 23));
  return false;
}

/** What is special about the day (shown on the zmanim card). */
export function specialDay(h: HDate, israel: boolean, weekday: number): string[] {
  const { year: y, month: m, day: d } = h;
  const out: string[] = [];
  const adar = isLeap(y) ? 13 : 12;
  if (d === 30 || (d === 1 && m !== 7)) out.push('Rosh Chodesh');
  if (m === 7 && (d === 1 || d === 2)) out.push('Rosh Hashanah');
  if (m === 7 && d === 10) out.push('Yom Kippur');
  if (m === 7 && d >= 15 && d <= 21) out.push(d === 15 || (!israel && d === 16) ? 'Sukkot' : d === 21 ? 'Hoshana Rabbah' : 'Chol Hamoed Sukkot');
  if (m === 7 && d === 22) out.push(israel ? 'Shemini Atzeret · Simchat Torah' : 'Shemini Atzeret');
  if (m === 7 && d === 23 && !israel) out.push('Simchat Torah');
  const kislev25 = fixedFromHebrew({ year: y, month: 9, day: 25 });
  const today = fixedFromHebrew(h);
  if (today >= kislev25 && today < kislev25 + 8) out.push(`Chanukah · day ${today - kislev25 + 1}`);
  if (m === 11 && d === 15) out.push('Tu BiShvat');
  if (m === adar && d === 14) out.push('Purim');
  if (m === adar && d === 15) out.push('Shushan Purim');
  if (m === 1 && d >= 15 && d <= 22) out.push(d === 15 || d === 21 || (!israel && (d === 16 || d === 22)) ? 'Pesach' : 'Chol Hamoed Pesach');
  if (m === 2 && d === 18) out.push('Lag BaOmer');
  if (m === 3 && (d === 6 || (!israel && d === 7))) out.push('Shavuot');
  if (m === 5 && (d === 9 || (d === 10 && weekday === 0))) out.push("Tisha B'Av");
  const omer = today - fixedFromHebrew({ year: y, month: 1, day: 16 }) + 1;
  if (omer >= 1 && omer <= 49) out.push(`Omer · day ${omer}`);
  if (weekday === 6) out.push('Shabbos');
  return out;
}

/** Candles are lit this evening: tomorrow is Shabbos or Yom Tov, and today is a weekday. */
export function candlesTonight(civil: Date, israel: boolean): boolean {
  const today = fixedFromCivil(civil.getFullYear(), civil.getMonth() + 1, civil.getDate());
  const weekday = civil.getDay();
  const restToday = weekday === 6 || isYomTov(hebrewFromFixed(today), israel);
  const restTomorrow = weekday === 5 || isYomTov(hebrewFromFixed(today + 1), israel);
  return restTomorrow && !restToday;
}
