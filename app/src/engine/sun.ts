// When the sun is at an angle below the horizon on a day at a place — the
// standard solar formulas (as in the SunCalc library), worked out offline.

const rad = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const J0 = 0.0009;
const e = rad * 23.4397;

const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY_MS;
const toDays = (ms: number) => ms / DAY_MS - 0.5 + J1970 - J2000;
const anomaly = (d: number) => rad * (357.5291 + 0.98560028 * d);
function longitude(M: number) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + Math.PI;
}
const declination = (l: number) => Math.asin(Math.sin(e) * Math.sin(l));
const transit = (ds: number, M: number, L: number) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

export interface SunDay {
  /** Midday (the sun at its highest), ms. */
  noon: number;
  /** When the sun's centre is `deg` degrees below the horizon: morning and evening, ms (null if it never is). */
  at(deg: number): { rise: number; set: number } | null;
}

/** The sun on a civil date (year, month 1–12, day) at a place. */
export function sunOn(y: number, m: number, d: number, lat: number, lon: number): SunDay {
  // Local noon there, so the day is the right one.
  const ms = Date.UTC(y, m - 1, d, 12) - (lon / 15) * 3_600_000;
  const lw = rad * -lon;
  const phi = rad * lat;
  const n = Math.round(toDays(ms) - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = anomaly(ds);
  const L = longitude(M);
  const dec = declination(L);
  const jnoon = transit(ds, M, L);
  return {
    noon: fromJulian(jnoon),
    at(deg: number) {
      const h = -deg * rad;
      const c = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
      if (c < -1 || c > 1) return null;
      const w = Math.acos(c);
      const a = J0 + (w + lw) / (2 * Math.PI) + n;
      const jset = transit(a, M, L);
      return { rise: fromJulian(jnoon - (jset - jnoon)), set: fromJulian(jset) };
    },
  };
}
