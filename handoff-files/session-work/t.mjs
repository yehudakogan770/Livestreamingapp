import * as h from './hebcal.mjs';
const f = h.fixedFromCivil(2026, 9, 12);
console.log('fixed', f);
const approx = Math.floor((f - -1373427) / (35975351 / 98496)) + 1;
console.log('approx', approx);
console.log(h.fixedFromHebrew({year:5787, month:7, day:1}));
