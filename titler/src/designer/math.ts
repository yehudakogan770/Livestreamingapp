// Math in number fields (like Figma and After Effects): "100+20", "1920/2",
// "(40+8)*2". Starting with an operator works from the current value:
// "*2" doubles it, "/4" quarters it, "+=10" / "-=10" add or take away.
// A small parser of its own (never eval).

/** The value typed (`current` for relative input), or null when it isn't a sum. */
export function evalMath(text: string, current = 0): number | null {
  let s = text.trim().replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  if (!s) return null;
  if (/^[*/]/.test(s)) s = `${current}${s}`;
  else if (/^[+-]=/.test(s)) s = `${current}${s[0]}${s.slice(2)}`;
  let i = 0;
  const peek = () => s[i];
  const space = () => {
    while (s[i] === ' ') i++;
  };
  const number = (): number | null => {
    space();
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const factor = (): number | null => {
    space();
    if (peek() === '-') {
      i++;
      const f = factor();
      return f === null ? null : -f;
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    if (peek() === '(') {
      i++;
      const v = sum();
      space();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    return number();
  };
  const product = (): number | null => {
    let v = factor();
    for (;;) {
      if (v === null) return null;
      space();
      const op = peek();
      if (op !== '*' && op !== '/' && op !== '%') return v;
      i++;
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
  };
  const sum = (): number | null => {
    let v = product();
    for (;;) {
      if (v === null) return null;
      space();
      const op = peek();
      if (op !== '+' && op !== '-') return v;
      i++;
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
  };
  const v = sum();
  space();
  if (v === null || i !== s.length || !Number.isFinite(v)) return null;
  return v;
}
