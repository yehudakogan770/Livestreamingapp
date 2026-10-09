// Expressions on properties (like After Effects'): a small, safe language of
// its own (never eval) that works out a property's value at a time from its
// keyframed value, the time, and other properties.
//
//   value + [0, 10]              the keyframed value, moved
//   wiggle(2, 8)                 a smooth random shake, 2 times a second, 8 px
//   loopOut() / loopOut("pingpong") / loopOut("offset") / loopIn()
//   time * 90                    turns 90° a second
//   link("Name box", "transform.opacity")   another layer's property
//   linear(time, 0, 1, 0, 100) · ease(…) · clamp(v, lo, hi) · random(lo, hi)
//   sin cos tan abs min max round floor ceil sqrt pow · PI
// Numbers and [x, y] pairs; + − × ÷ work on pairs part by part. Comparisons
// and `cond ? a : b`. Anything that can't be worked out keeps the value.

import type { Keyframe, Prop, Value } from './types';

type V = number | number[] | string;

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; name: string }
  | { k: 'arr'; items: Node[] }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'index'; of: Node; at: Node }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'cond'; c: Node; a: Node; b: Node };

const TOKEN = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)|("[^"]*"|'[^']*')|([A-Za-z_]\w*)|(<=|>=|==|!=|&&|\|\||[-+*/%()[\],?:<>!]))/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let at = 0;
  while (at < src.length) {
    if (/^\s*$/.test(src.slice(at))) break;
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Not understood at “${src.slice(at, at + 12)}”`);
    out.push(m[1] ?? m[2] ?? m[3] ?? m[4]!);
    at = TOKEN.lastIndex;
  }
  return out;
}

function parse(src: string): Node {
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const take = (want?: string) => {
    const x = t[i++];
    if (want !== undefined && x !== want) throw new Error(`“${want}” missing`);
    if (x === undefined) throw new Error('It ends too soon');
    return x;
  };
  const binary = (next: () => Node, ops: string[]) => () => {
    let a = next();
    while (ops.includes(peek() ?? '')) {
      const op = take();
      a = { k: 'bin', op, a, b: next() };
    }
    return a;
  };
  const primary = (): Node => {
    const x = take();
    if (/^[\d.]/.test(x)) return { k: 'num', v: Number(x) };
    if (x[0] === '"' || x[0] === "'") return { k: 'str', v: x.slice(1, -1) };
    if (x === '(') {
      const e = expr();
      take(')');
      return e;
    }
    if (x === '[') {
      const items: Node[] = [];
      if (peek() !== ']')
        do items.push(expr());
        while (peek() === ',' && take());
      take(']');
      return { k: 'arr', items };
    }
    if (/^[A-Za-z_]/.test(x)) {
      if (peek() === '(') {
        take('(');
        const args: Node[] = [];
        if (peek() !== ')')
          do args.push(expr());
          while (peek() === ',' && take());
        take(')');
        return { k: 'call', name: x, args };
      }
      return { k: 'id', name: x };
    }
    throw new Error(`Not expected: “${x}”`);
  };
  const postfix = (): Node => {
    let n = primary();
    while (peek() === '[') {
      take('[');
      n = { k: 'index', of: n, at: expr() };
      take(']');
    }
    return n;
  };
  const unary = (): Node => (peek() === '-' || peek() === '+' || peek() === '!' ? { k: 'un', op: take(), a: unary() } : postfix());
  const mul = binary(unary, ['*', '/', '%']);
  const add = binary(mul, ['+', '-']);
  const cmp = binary(add, ['<', '>', '<=', '>=', '==', '!=']);
  const and = binary(cmp, ['&&']);
  const or = binary(and, ['||']);
  function expr(): Node {
    const c = or();
    if (peek() !== '?') return c;
    take('?');
    const a = expr();
    take(':');
    return { k: 'cond', c, a, b: expr() };
  }
  const out = expr();
  if (i < t.length) throw new Error(`Not expected: “${t[i]}”`);
  return out;
}

const parsed = new Map<string, Node | Error>();
function compile(src: string): Node | Error {
  let n = parsed.get(src);
  if (!n) {
    try {
      n = parse(src);
    } catch (e) {
      n = e instanceof Error ? e : new Error(String(e));
    }
    if (parsed.size > 500) parsed.clear();
    parsed.set(src, n);
  }
  return n;
}

/** Why an expression can't be worked out (null when it can). */
export function exprProblem(src: string): string | null {
  const n = compile(src);
  return n instanceof Error ? n.message : null;
}

// ---- values ----

const isArr = (v: V): v is number[] => Array.isArray(v);
const numOf = (v: V): number => (typeof v === 'number' ? v : isArr(v) ? (v[0] ?? 0) : Number(v) || 0);

function zip(a: V, b: V, f: (x: number, y: number) => number): V {
  if (isArr(a) && isArr(b)) return a.map((x, i) => f(x, b[i] ?? 0));
  if (isArr(a)) return a.map((x) => f(x, numOf(b)));
  if (isArr(b)) return b.map((y) => f(numOf(a), y));
  return f(numOf(a), numOf(b));
}

/** A smooth random wave in −1…1 (the same for the same seed and time). */
export function noise1(x: number, seed: number): number {
  const h = (n: number) => {
    let z = Math.imul((n | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
    z ^= z >>> 13;
    z = Math.imul(z, 0xc2b2ae35);
    z ^= z >>> 16;
    return ((z >>> 0) / 4294967295) * 2 - 1;
  };
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return h(i) * (1 - s) + h(i + 1) * s;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h | 0;
}

/** What an expression can ask for besides its own property. */
export interface ExprScope {
  /** Another layer's property at a time (link). */
  link?(layer: string, path: string, t: number): Value | undefined;
}

let scope: ExprScope = {};
/** Set by the renderer while it draws a composition (links find layers in it). */
export function setExprScope(s: ExprScope): ExprScope {
  const before = scope;
  scope = s;
  return before;
}

let depth = 0;

/** The keyframed value at a time (no expression). */
type Base = (t: number) => Value;

function loop(p: Prop<Value>, base: Base, t: number, type: string, out: boolean): Value | null {
  const k = (p as { k?: Keyframe<Value>[] }).k;
  if (!k || k.length < 2) return null;
  const first = k[0]!.t;
  const last = k[k.length - 1]!.t;
  const dur = last - first;
  if (dur <= 0) return null;
  if (out ? t <= last : t >= first) return null;
  const from = out ? t - first : last - t;
  const n = Math.floor(from / dur);
  const r = from - n * dur;
  if (type === 'pingpong') {
    const tt = n % 2 === 0 ? (out ? first + r : last - r) : out ? last - r : first + r;
    return base(tt);
  }
  const tt = out ? first + r : last - r;
  const v = base(tt);
  if (type !== 'offset') return v;
  const d = zip(base(last), base(first), (a, b) => a - b);
  return zip(v, d, (a, b) => a + (out ? b * n : -b * n)) as Value;
}

function evaluate(n: Node, ctx: { time: number; value: V; prop: Prop<Value>; base: Base; seed: number }): V {
  const ev = (x: Node) => evaluate(x, ctx);
  switch (n.k) {
    case 'num':
      return n.v;
    case 'str':
      return n.v;
    case 'arr':
      return n.items.map((x) => numOf(ev(x)));
    case 'index': {
      const of = ev(n.of);
      return isArr(of) ? (of[Math.round(numOf(ev(n.at)))] ?? 0) : numOf(of);
    }
    case 'id':
      if (n.name === 'time') return ctx.time;
      if (n.name === 'value') return ctx.value;
      if (n.name === 'PI') return Math.PI;
      throw new Error(`Unknown name “${n.name}”`);
    case 'un': {
      const a = ev(n.a);
      if (n.op === '!') return numOf(a) ? 0 : 1;
      return n.op === '-' ? zip(a, 0, (x) => -x) : a;
    }
    case 'cond':
      return numOf(ev(n.c)) ? ev(n.a) : ev(n.b);
    case 'bin': {
      const a = ev(n.a);
      const b = ev(n.b);
      switch (n.op) {
        case '+':
          return zip(a, b, (x, y) => x + y);
        case '-':
          return zip(a, b, (x, y) => x - y);
        case '*':
          return zip(a, b, (x, y) => x * y);
        case '/':
          return zip(a, b, (x, y) => (y === 0 ? 0 : x / y));
        case '%':
          return zip(a, b, (x, y) => (y === 0 ? 0 : x % y));
        case '<':
          return numOf(a) < numOf(b) ? 1 : 0;
        case '>':
          return numOf(a) > numOf(b) ? 1 : 0;
        case '<=':
          return numOf(a) <= numOf(b) ? 1 : 0;
        case '>=':
          return numOf(a) >= numOf(b) ? 1 : 0;
        case '==':
          return JSON.stringify(a) === JSON.stringify(b) ? 1 : 0;
        case '!=':
          return JSON.stringify(a) !== JSON.stringify(b) ? 1 : 0;
        case '&&':
          return numOf(a) && numOf(b) ? 1 : 0;
        case '||':
          return numOf(a) || numOf(b) ? 1 : 0;
      }
      throw new Error(n.op);
    }
    case 'call': {
      const args = n.args.map(ev);
      const x = (i: number, d = 0) => (args[i] === undefined ? d : numOf(args[i]!));
      const m1 = (f: (v: number) => number) => zip(args[0] ?? 0, 0, (v) => f(v));
      switch (n.name) {
        case 'sin':
          return m1(Math.sin);
        case 'cos':
          return m1(Math.cos);
        case 'tan':
          return m1(Math.tan);
        case 'abs':
          return m1(Math.abs);
        case 'round':
          return m1(Math.round);
        case 'floor':
          return m1(Math.floor);
        case 'ceil':
          return m1(Math.ceil);
        case 'sqrt':
          return m1((v) => Math.sqrt(Math.max(0, v)));
        case 'pow':
          return Math.pow(x(0), x(1, 1));
        case 'min':
          return Math.min(...args.map(numOf));
        case 'max':
          return Math.max(...args.map(numOf));
        case 'clamp':
          return zip(args[0] ?? 0, 0, (v) => Math.min(x(2, v), Math.max(x(1, v), v)));
        case 'linear':
        case 'ease': {
          // linear(t, tMin, tMax, a, b): a at tMin to b at tMax (ease: smoothly).
          const t0 = x(1);
          const t1 = x(2, 1);
          let f = t1 === t0 ? 1 : Math.min(1, Math.max(0, (x(0) - t0) / (t1 - t0)));
          if (n.name === 'ease') f = f * f * (3 - 2 * f);
          return zip(args[3] ?? 0, args[4] ?? 0, (a, b) => a + (b - a) * f);
        }
        case 'random': {
          // The same at the same frame (60 a second) and seed.
          const r = (noise1(Math.floor(ctx.time * 60) + 0.5, ctx.seed + 7) + 1) / 2;
          if (!args.length) return r;
          if (args.length === 1) return x(0) * r;
          return x(0) + (x(1) - x(0)) * r;
        }
        case 'wiggle': {
          const freq = x(0, 1);
          const amp = x(1, 0);
          const seed = ctx.seed + x(2) * 7919;
          const w = (i: number) => (noise1(ctx.time * freq, seed + i * 101) + 0.5 * noise1(ctx.time * freq * 2, seed + i * 211)) / 1.5;
          return isArr(ctx.value) ? ctx.value.map((v, i) => v + amp * w(i)) : numOf(ctx.value) + amp * w(0);
        }
        case 'loopOut':
        case 'loopIn': {
          const type = typeof args[0] === 'string' ? args[0] : 'cycle';
          return (loop(ctx.prop, ctx.base, ctx.time, type, n.name === 'loopOut') as V | null) ?? ctx.value;
        }
        case 'link': {
          const layer = typeof args[0] === 'string' ? args[0] : '';
          const path = typeof args[1] === 'string' ? args[1] : '';
          const got = scope.link?.(layer, path, ctx.time);
          if (got === undefined) throw new Error(`No layer “${layer}” with “${path}”`);
          return got as V;
        }
      }
      throw new Error(`Unknown function “${n.name}”`);
    }
  }
}

/**
 * A property's value with its expression: `value` is the keyframed value at
 * `time`, `base` gives it at any time. Keeps `value` if the expression can't
 * be worked out or gives the wrong kind of value.
 */
export function applyExpr<T extends Value>(src: string, prop: Prop<T>, time: number, value: T, base: (t: number) => T): T {
  const n = compile(src);
  if (n instanceof Error || depth > 8) return value;
  depth++;
  try {
    const out = evaluate(n, { time, value, prop: prop as Prop<Value>, base: base as Base, seed: hashString(src) });
    if (Array.isArray(value)) {
      if (isArr(out) && out.length >= 2 && out.every(Number.isFinite)) return [out[0]!, out[1]!] as T;
      if (typeof out === 'number' && Number.isFinite(out)) return [out, out] as T;
      return value;
    }
    const v = numOf(out);
    return (Number.isFinite(v) ? v : value) as T;
  } catch {
    return value;
  } finally {
    depth--;
  }
}

/** Is this property moved by its expression over time (not just still)? */
export const hasExpr = (p: Prop<Value> | undefined): boolean => !!p && typeof (p as { x?: string }).x === 'string' && !!(p as { x?: string }).x!.trim();
