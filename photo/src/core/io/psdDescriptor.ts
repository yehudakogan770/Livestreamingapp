// Photoshop's "action descriptors": the typed key/value structures PSD uses
// for layer effects, fill layers, newer adjustments and type layers.

import { Reader, Writer } from './bytes';

export type DValue =
  | { t: 'doub'; v: number }
  | { t: 'UntF'; unit: string; v: number }
  | { t: 'long'; v: number }
  | { t: 'comp'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'TEXT'; v: string }
  | { t: 'enum'; type: string; v: string }
  | { t: 'Objc'; d: Descriptor }
  | { t: 'GlbO'; d: Descriptor }
  | { t: 'VlLs'; v: DValue[] }
  | { t: 'tdta'; v: Uint8Array }
  | { t: 'type'; name: string; cls: string }
  | { t: 'UnFl'; unit: string; v: number[] }
  | { t: 'obj '; raw: Uint8Array }
  | { t: 'alis'; v: Uint8Array };

export interface Descriptor {
  name: string;
  cls: string;
  items: [string, DValue][];
}

function readUnicode(r: Reader): string {
  const n = r.u32();
  let s = '';
  for (let i = 0; i < n; i++) {
    const c = r.u16();
    if (c) s += String.fromCharCode(c);
  }
  return s;
}

function readKey(r: Reader): string {
  const n = r.u32();
  return r.ascii(n === 0 ? 4 : n);
}

function readValue(r: Reader, type: string): DValue {
  switch (type) {
    case 'doub':
      return { t: 'doub', v: r.f64() };
    case 'UntF': {
      const unit = r.ascii(4);
      return { t: 'UntF', unit, v: r.f64() };
    }
    case 'UnFl': {
      const unit = r.ascii(4);
      const n = r.u32();
      const v: number[] = [];
      for (let i = 0; i < n; i++) v.push(r.f64());
      return { t: 'UnFl', unit, v };
    }
    case 'long':
      return { t: 'long', v: r.i32() };
    case 'comp':
      return { t: 'comp', v: r.u64() };
    case 'bool':
      return { t: 'bool', v: r.u8() !== 0 };
    case 'TEXT':
      return { t: 'TEXT', v: readUnicode(r) };
    case 'enum': {
      const et = readKey(r);
      return { t: 'enum', type: et, v: readKey(r) };
    }
    case 'Objc':
    case 'GlbO':
      return { t: type, d: readDescriptor(r) } as DValue;
    case 'VlLs': {
      const n = r.u32();
      const v: DValue[] = [];
      for (let i = 0; i < n; i++) v.push(readValue(r, r.ascii(4)));
      return { t: 'VlLs', v };
    }
    case 'tdta':
    case 'alis': {
      const n = r.u32();
      return { t: type, v: r.take(n).slice() } as DValue;
    }
    case 'type':
    case 'GlbC':
      return { t: 'type', name: readUnicode(r), cls: readKey(r) };
    case 'obj ': {
      // References: read past them (we don't use them).
      const start = r.pos;
      const n = r.u32();
      for (let i = 0; i < n; i++) {
        const k = r.ascii(4);
        if (k === 'prop') {
          readUnicode(r);
          readKey(r);
          readKey(r);
        } else if (k === 'Clss') {
          readUnicode(r);
          readKey(r);
        } else if (k === 'Enmr') {
          readUnicode(r);
          readKey(r);
          readKey(r);
          readKey(r);
        } else if (k === 'rele') {
          readUnicode(r);
          readKey(r);
          r.u32();
        } else if (k === 'Idnt' || k === 'indx') r.u32();
        else if (k === 'name') {
          readUnicode(r);
          readKey(r);
          readUnicode(r);
        }
      }
      return { t: 'obj ', raw: r.bytes.slice(start, r.pos) };
    }
    default:
      throw new Error(`Unknown descriptor value type “${type}”.`);
  }
}

export function readDescriptor(r: Reader): Descriptor {
  const name = readUnicode(r);
  const cls = readKey(r);
  const n = r.u32();
  const items: [string, DValue][] = [];
  for (let i = 0; i < n; i++) {
    const k = readKey(r);
    const type = r.ascii(4);
    items.push([k, readValue(r, type)]);
  }
  return { name, cls, items };
}

function writeUnicode(w: Writer, s: string): void {
  w.u32(s.length + 1);
  for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i));
  w.u16(0);
}

function writeKey(w: Writer, k: string): void {
  if (k.length === 4) {
    w.u32(0);
    w.ascii(k);
  } else {
    w.u32(k.length);
    w.ascii(k);
  }
}

function writeValue(w: Writer, v: DValue): void {
  w.ascii(v.t === 'type' ? 'type' : v.t);
  switch (v.t) {
    case 'doub':
      w.f64(v.v);
      return;
    case 'UntF':
      w.ascii(v.unit).f64(v.v);
      return;
    case 'UnFl':
      w.ascii(v.unit).u32(v.v.length);
      for (const x of v.v) w.f64(x);
      return;
    case 'long':
      w.i32(v.v);
      return;
    case 'comp':
      w.u64(v.v);
      return;
    case 'bool':
      w.u8(v.v ? 1 : 0);
      return;
    case 'TEXT':
      writeUnicode(w, v.v);
      return;
    case 'enum':
      writeKey(w, v.type);
      writeKey(w, v.v);
      return;
    case 'Objc':
    case 'GlbO':
      writeDescriptor(w, v.d);
      return;
    case 'VlLs':
      w.u32(v.v.length);
      for (const x of v.v) writeValue(w, x);
      return;
    case 'tdta':
    case 'alis':
      w.u32(v.v.length).bytes(v.v);
      return;
    case 'type':
      writeUnicode(w, v.name);
      writeKey(w, v.cls);
      return;
    case 'obj ':
      w.bytes(v.raw);
      return;
  }
}

export function writeDescriptor(w: Writer, d: Descriptor): void {
  writeUnicode(w, d.name);
  writeKey(w, d.cls);
  w.u32(d.items.length);
  for (const [k, v] of d.items) {
    writeKey(w, k);
    writeValue(w, v);
  }
}

// ---- small helpers to build and read descriptors ----

export const D = {
  obj: (cls: string, items: [string, DValue][], name = ''): DValue => ({ t: 'Objc', d: { name, cls, items } }),
  num: (v: number): DValue => ({ t: 'doub', v }),
  unit: (unit: string, v: number): DValue => ({ t: 'UntF', unit, v }),
  long: (v: number): DValue => ({ t: 'long', v }),
  bool: (v: boolean): DValue => ({ t: 'bool', v }),
  text: (v: string): DValue => ({ t: 'TEXT', v }),
  en: (type: string, v: string): DValue => ({ t: 'enum', type, v }),
  list: (v: DValue[]): DValue => ({ t: 'VlLs', v }),
};

export function get(d: Descriptor | undefined, key: string): DValue | undefined {
  return d?.items.find(([k]) => k === key)?.[1];
}

export function getNum(d: Descriptor | undefined, key: string, def = 0): number {
  const v = get(d, key);
  if (!v) return def;
  if (v.t === 'doub' || v.t === 'UntF' || v.t === 'long' || v.t === 'comp') return v.v;
  return def;
}

export function getBool(d: Descriptor | undefined, key: string, def = false): boolean {
  const v = get(d, key);
  return v?.t === 'bool' ? v.v : def;
}

export function getEnum(d: Descriptor | undefined, key: string, def = ''): string {
  const v = get(d, key);
  return v?.t === 'enum' ? v.v : def;
}

export function getObj(d: Descriptor | undefined, key: string): Descriptor | undefined {
  const v = get(d, key);
  return v?.t === 'Objc' || v?.t === 'GlbO' ? v.d : undefined;
}

export function getText(d: Descriptor | undefined, key: string, def = ''): string {
  const v = get(d, key);
  return v?.t === 'TEXT' ? v.v : def;
}

export function getList(d: Descriptor | undefined, key: string): DValue[] {
  const v = get(d, key);
  return v?.t === 'VlLs' ? v.v : [];
}

/** An RGB color object (Rd, Grn, Bl 0..255) as 0..1. */
export function readColor(d: Descriptor | undefined): [number, number, number] {
  if (!d) return [0, 0, 0];
  if (d.cls === 'Grsc') {
    const g = 1 - getNum(d, 'Gry ') / 100;
    return [g, g, g];
  }
  return [getNum(d, 'Rd  ') / 255, getNum(d, 'Grn ') / 255, getNum(d, 'Bl  ') / 255];
}

export function colorValue(c: readonly number[]): DValue {
  return D.obj('RGBC', [
    ['Rd  ', D.num(c[0]! * 255)],
    ['Grn ', D.num(c[1]! * 255)],
    ['Bl  ', D.num(c[2]! * 255)],
  ]);
}
