import * as h from './hebcal.ts';
// Every day for 60 years: one day after another, never stuck.
let prev = h.hebrewFromFixed(h.fixedFromCivil(1990, 1, 1));
for (let d = h.fixedFromCivil(1990, 1, 2); d < h.fixedFromCivil(2050, 1, 1); d++) {
  const x = h.hebrewFromFixed(d);
  if (h.fixedFromHebrew(x) !== d) throw new Error('round trip ' + d);
  prev = x;
}
console.log('ok', h.formatHebrew(prev));
