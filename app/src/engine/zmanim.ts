// The day's zmanim at the event's place, candle lighting, and the cities to
// pick from. All worked out on the computer, offline.

import type { Place } from './types/Place';
import { candlesTonight, fixedFromCivil, hebrewFromFixed, specialDay, type HDate } from './hebcal';
import { sunOn } from './sun';

export const defaultPlace = (): Place => ({
  name: '',
  latMicro: 0,
  lonMicro: 0,
  candleMinutes: 18,
  israel: false,
  stopBefore: false,
  stopMinutes: 10,
  warnMonitor: true,
});

/** A place has been chosen. */
export const hasPlace = (p: Place | undefined): p is Place => !!p && !!p.name && (p.latMicro !== 0 || p.lonMicro !== 0);

export interface DayZmanim {
  /** The Hebrew date (of the daytime; after sunset it is the next day). */
  hebrew: HDate;
  /** After sunset: the Hebrew date has moved on. */
  evening: boolean;
  alot: number | null;
  sunrise: number | null;
  sofShema: number | null;
  chatzot: number;
  minchaGedola: number | null;
  sunset: number | null;
  tzeit: number | null;
  /** Candle lighting this evening (Friday, the eve of Yom Tov), ms. */
  candles: number | null;
  special: string[];
}

/** The zmanim of the civil day that `at` falls in (the computer's own clock and date). */
export function zmanimOn(at: number, p: Place): DayZmanim {
  const date = new Date(at);
  const [y, m, d] = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  const sun = sunOn(y, m, d, p.latMicro / 1e6, p.lonMicro / 1e6);
  const rise = sun.at(0.833);
  const dawn = sun.at(16.1);
  const dusk = sun.at(8.5);
  const hour = rise ? (rise.set - rise.rise) / 12 : null;
  const evening = !!rise && at >= rise.set;
  const today = fixedFromCivil(y, m, d);
  const hebrew = hebrewFromFixed(evening ? today + 1 : today);
  const candles = rise && candlesTonight(date, p.israel) ? rise.set - p.candleMinutes * 60_000 : null;
  return {
    hebrew,
    evening,
    alot: dawn?.rise ?? null,
    sunrise: rise?.rise ?? null,
    sofShema: rise && hour ? rise.rise + 3 * hour : null,
    chatzot: sun.noon,
    minchaGedola: hour ? sun.noon + hour / 2 : null,
    sunset: rise?.set ?? null,
    tzeit: dusk?.set ?? null,
    candles,
    special: specialDay(hebrewFromFixed(today), p.israel, date.getDay()),
  };
}

/** The next candle lighting from `now` (within a week), ms, or null. */
export function nextCandles(now: number, p: Place): number | null {
  for (let i = 0; i < 8; i++) {
    const day = new Date(now);
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + i);
    const c = zmanimOn(day.getTime(), p).candles;
    if (c !== null && c > now) return c;
  }
  return null;
}

/** "6:42 PM" (or "18:42", as this computer shows times). */
export const clockTime = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));

/** "1:12:05" or "12:05" */
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Cities to pick from: name, latitude, longitude, minutes before sunset for candles. */
export const CITIES: [string, number, number, number][] = [
  ['Jerusalem', 31.7683, 35.2137, 40],
  ['Tel Aviv', 32.0853, 34.7818, 20],
  ['Bnei Brak', 32.0807, 34.8338, 20],
  ['Haifa', 32.794, 34.9896, 30],
  ['Beit Shemesh', 31.7497, 34.9885, 30],
  ['Petah Tikva', 32.0871, 34.8875, 20],
  ['Safed', 32.9646, 35.496, 30],
  ['Beersheba', 31.252, 34.7915, 20],
  ['New York', 40.7128, -74.006, 18],
  ['Brooklyn', 40.6782, -73.9442, 18],
  ['Monsey', 41.1112, -74.0685, 18],
  ['Lakewood', 40.0821, -74.2097, 18],
  ['Passaic', 40.8568, -74.1285, 18],
  ['Five Towns', 40.6343, -73.7271, 18],
  ['Philadelphia', 39.9526, -75.1652, 18],
  ['Baltimore', 39.2904, -76.6122, 18],
  ['Washington DC', 38.9072, -77.0369, 18],
  ['Boston', 42.3601, -71.0589, 18],
  ['Cleveland', 41.4993, -81.6944, 18],
  ['Detroit', 42.3314, -83.0458, 18],
  ['Chicago', 41.8781, -87.6298, 18],
  ['Miami', 25.7617, -80.1918, 18],
  ['Atlanta', 33.749, -84.388, 18],
  ['Dallas', 32.7767, -96.797, 18],
  ['Houston', 29.7604, -95.3698, 18],
  ['Denver', 39.7392, -104.9903, 18],
  ['Phoenix', 33.4484, -112.074, 18],
  ['Los Angeles', 34.0522, -118.2437, 18],
  ['San Francisco', 37.7749, -122.4194, 18],
  ['Seattle', 47.6062, -122.3321, 18],
  ['Toronto', 43.6532, -79.3832, 18],
  ['Montreal', 45.5017, -73.5673, 18],
  ['London', 51.5074, -0.1278, 18],
  ['Manchester', 53.4808, -2.2426, 18],
  ['Paris', 48.8566, 2.3522, 18],
  ['Antwerp', 51.2194, 4.4025, 18],
  ['Amsterdam', 52.3676, 4.9041, 18],
  ['Zurich', 47.3769, 8.5417, 18],
  ['Moscow', 55.7558, 37.6173, 18],
  ['Kyiv', 50.4501, 30.5234, 18],
  ['Johannesburg', -26.2041, 28.0473, 18],
  ['Melbourne', -37.8136, 144.9631, 18],
  ['Sydney', -33.8688, 151.2093, 18],
  ['Buenos Aires', -34.6037, -58.3816, 18],
  ['São Paulo', -23.5505, -46.6333, 18],
  ['Mexico City', 19.4326, -99.1332, 18],
  ['Panama City', 8.9824, -79.5199, 18],
];
