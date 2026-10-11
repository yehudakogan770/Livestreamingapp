// Lossless JPEG (ITU T.81 process 14, "LJ92"), the compression most DNG
// files use for their raw data: Huffman-coded differences from one of seven
// predictors, 2–16 bits, any number of components, restart intervals.

export interface LJ92 {
  width: number;
  height: number;
  components: number;
  precision: number;
  /** Samples, components interleaved, row by row. */
  data: Uint16Array;
}

interface Huff {
  /** (length << 16 | code) → value, built for fast lookup by code length. */
  maxCode: Int32Array;
  valPtr: Int32Array;
  minCode: Int32Array;
  values: Uint8Array;
  /** 9-bit quick table: value | length << 8, or −1. */
  fast: Int32Array;
}

function buildHuff(counts: Uint8Array, values: Uint8Array): Huff {
  const maxCode = new Int32Array(18).fill(-1),
    valPtr = new Int32Array(17),
    minCode = new Int32Array(17);
  let code = 0,
    k = 0;
  for (let len = 1; len <= 16; len++) {
    valPtr[len] = k;
    minCode[len] = code;
    code += counts[len - 1]!;
    k += counts[len - 1]!;
    maxCode[len] = counts[len - 1]! ? code - 1 : -1;
    code <<= 1;
  }
  maxCode[17] = 0x7fffffff;
  const fast = new Int32Array(512).fill(-1);
  let c = 0;
  k = 0;
  for (let len = 1; len <= 9; len++) {
    for (let i = 0; i < counts[len - 1]!; i++) {
      const shift = 9 - len;
      for (let j = 0; j < 1 << shift; j++) fast[(c << shift) | j] = values[k]! | (len << 8);
      c++;
      k++;
    }
    c <<= 1;
  }
  return { maxCode, valPtr, minCode, values, fast };
}

class Bits {
  private pos: number;
  private acc = 0;
  private n = 0;
  marker = -1;
  constructor(
    private readonly b: Uint8Array,
    start: number,
  ) {
    this.pos = start;
  }
  private fill(): void {
    while (this.n <= 24) {
      let byte = 0;
      if (this.marker < 0 && this.pos < this.b.length) {
        byte = this.b[this.pos++]!;
        if (byte === 0xff) {
          const nx = this.b[this.pos] ?? 0;
          if (nx === 0) this.pos++;
          else {
            // A marker: stop feeding real bits.
            this.marker = nx;
            this.pos--;
            byte = 0;
          }
        }
      }
      this.acc = ((this.acc << 8) | byte) >>> 0;
      this.n += 8;
    }
  }
  peek(k: number): number {
    if (this.n < k) this.fill();
    return (this.acc >>> (this.n - k)) & ((1 << k) - 1);
  }
  skip(k: number): void {
    this.n -= k;
  }
  get(k: number): number {
    if (k === 0) return 0;
    const v = this.peek(k);
    this.skip(k);
    return v;
  }
  /** Past a restart marker: reset the bit buffer. */
  restart(): void {
    this.acc = 0;
    this.n = 0;
    if (this.marker >= 0xd0 && this.marker <= 0xd7) {
      this.pos += 2;
      this.marker = -1;
    }
  }
}

function decodeSym(bits: Bits, h: Huff): number {
  const q = h.fast[bits.peek(9)]!;
  if (q >= 0) {
    bits.skip(q >> 8);
    return q & 255;
  }
  let code = bits.get(1);
  let len = 1;
  while (code > h.maxCode[len]! && len < 17) {
    code = (code << 1) | bits.get(1);
    len++;
  }
  if (len > 16) return 0;
  return h.values[h.valPtr[len]! + code - h.minCode[len]!]!;
}

export function decodeLJ92(b: Uint8Array): LJ92 {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('The raw data is not lossless JPEG.');
  let i = 2;
  const huffs: Huff[] = [];
  let width = 0,
    height = 0,
    precision = 0,
    ncomp = 0;
  const compIds: number[] = [];
  let restart = 0;
  for (;;) {
    while (b[i] === 0xff && b[i + 1] === 0xff) i++;
    if (b[i] !== 0xff) throw new Error('The raw data is damaged.');
    const m = b[i + 1]!;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    const seg = b.subarray(i + 4, i + 2 + len);
    if (m === 0xc3) {
      precision = seg[0]!;
      height = (seg[1]! << 8) | seg[2]!;
      width = (seg[3]! << 8) | seg[4]!;
      ncomp = seg[5]!;
      for (let c = 0; c < ncomp; c++) compIds.push(seg[6 + c * 3]!);
    } else if (m === 0xc4) {
      let p = 0;
      while (p < seg.length) {
        const id = seg[p]! & 15;
        const counts = seg.subarray(p + 1, p + 17);
        let n = 0;
        for (const c of counts) n += c;
        huffs[id] = buildHuff(counts, seg.subarray(p + 17, p + 17 + n));
        p += 17 + n;
      }
    } else if (m === 0xdd) restart = (seg[0]! << 8) | seg[1]!;
    else if (m === 0xda) {
      const ns = seg[0]!;
      const tables: Huff[] = [];
      for (let c = 0; c < ns; c++) tables.push(huffs[seg[2 + c * 2]! >> 4]!);
      const pred = seg[1 + ns * 2]!;
      const pt = seg[3 + ns * 2]! & 15;
      const data = new Uint16Array(width * height * ncomp);
      const bits = new Bits(b, i + 2 + len);
      const rowLen = width * ncomp;
      const initial = 1 << (precision - pt - 1);
      let mcus = 0;
      // After a restart marker, prediction starts over as on the first line.
      let firstRow = 0,
        firstCol = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (restart && mcus && mcus % restart === 0) {
            bits.restart();
            firstRow = y;
            firstCol = x;
          }
          for (let c = 0; c < ncomp; c++) {
            const s = decodeSym(bits, tables[c] ?? tables[0]!);
            let diff: number;
            if (s === 0) diff = 0;
            else if (s === 16) diff = 32768;
            else {
              diff = bits.get(s);
              if (diff < 1 << (s - 1)) diff -= (1 << s) - 1;
            }
            const at = y * rowLen + x * ncomp + c;
            let p: number;
            if (y === firstRow && x === firstCol) p = initial;
            else if (y === firstRow) p = data[at - ncomp]!;
            else if (x === 0) p = data[at - rowLen]!;
            else {
              const ra = data[at - ncomp]!,
                rb = data[at - rowLen]!,
                rc = data[at - rowLen - ncomp]!;
              switch (pred) {
                case 1:
                  p = ra;
                  break;
                case 2:
                  p = rb;
                  break;
                case 3:
                  p = rc;
                  break;
                case 4:
                  p = ra + rb - rc;
                  break;
                case 5:
                  p = ra + ((rb - rc) >> 1);
                  break;
                case 6:
                  p = rb + ((ra - rc) >> 1);
                  break;
                case 7:
                  p = (ra + rb) >> 1;
                  break;
                default:
                  p = ra;
              }
            }
            data[at] = (p + diff) & 0xffff;
          }
          mcus++;
        }
      }
      return { width, height, components: ncomp, precision, data };
    } else if (m === 0xd9) break;
    i += 2 + len;
    if (i >= b.length) break;
  }
  throw new Error('The raw data has no picture.');
}
