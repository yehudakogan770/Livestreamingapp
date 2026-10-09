// Plans in and out of spreadsheets: CSV (Excel, Numbers, Google Sheets),
// Excel files (.xlsx), text pasted from a sheet, and calendar files (.ics).
// No network and no React here.

import { KIND_WORDS, type Item, type ItemKind } from './items';
import type { Block } from './blocks';
import {
  SEGMENTS,
  clock12,
  clock24,
  cueLabel,
  formatDuration,
  isSegment,
  parseClock,
  parseDuration,
  schedule,
  segmentName,
  sortCues,
  type CustomColumn,
  type Plan,
  type PlanCue,
  type Segment,
} from './model';

// ---- CSV ----

/** Rows of cells from CSV (or tab-separated text, as pasted from a sheet). Quotes, commas and line breaks in cells work. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep =
    (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? '\t'
      : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
        ? ';'
        : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const cellOut = (v: string): string => {
  // A leading = + - @ would be read as a formula by spreadsheet apps.
  const safe = /^[=+\-@]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Rows as CSV (with a byte-order mark, so Excel reads accents and symbols right). */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return '\uFEFF' + rows.map((r) => r.map(cellOut).join(',')).join('\r\n') + '\r\n';
}

// ---- The run of show as a sheet ----

export const CUE_HEADERS = [
  '#',
  'Section',
  'Start',
  'Fixed start',
  'Length',
  'Type',
  'Cue',
  'Who',
  'Input',
  'Transition',
  'Title or overlay',
  'Notes',
  'Script',
  'Color',
  'Floated',
];

/** The run of show as rows (a header row first), with the plan's extra columns at the end. */
export function cuesToRows(cues: readonly PlanCue[], showStart: string, columns: readonly CustomColumn[] = []): string[][] {
  const sorted = sortCues(cues);
  const s = schedule(sorted, showStart);
  return [
    [...CUE_HEADERS, ...columns.map((c) => c.name)],
    ...sorted.map((c, i) => {
      const t = s.rows[i]!;
      return [
        String(i + 1),
        c.section,
        t.start !== null && !t.skipped ? clock12(t.start) : '',
        c.startTime ? clock12(parseClock(c.startTime) ?? 0) : '',
        formatDuration(c.durationSec),
        segmentName(c.segment),
        c.title,
        c.who,
        c.input,
        c.transition,
        c.overlay,
        c.notes,
        c.script,
        c.color,
        c.skip ? 'yes' : '',
        ...columns.map((col) => c.custom[col.id] ?? ''),
      ];
    }),
  ];
}

type Field =
  | 'title'
  | 'section'
  | 'start'
  | 'fixed'
  | 'length'
  | 'end'
  | 'segment'
  | 'who'
  | 'input'
  | 'transition'
  | 'overlay'
  | 'notes'
  | 'script'
  | 'color'
  | 'skip'
  | 'skipnum';

/** Header words other tools and sheets use, matched loosely. */
const HEADER_WORDS: [Field, RegExp][] = [
  ['skipnum', /^(#|no\.?|num(ber)?|cue ?#|cue (no|number)|item ?#|page)$/],
  ['title', /^(cue|title|cue name|item|segment name|story|slug|name|description|what|element|topic|act)$/],
  ['section', /^(section|block|part|header|group|chapter)$/],
  ['fixed', /^(fixed|fixed start|fixed time|hard start|hard time|hard out)$/],
  ['start', /^(start|start time|time|begins?|clock|front ?time|time of day|tod|scheduled)$/],
  ['length', /^(length|duration|dur|len|run ?time|est(imated)?( duration)?|planned|time allotted|mins?|minutes)$/],
  ['end', /^(end|end time|ends?|finish|back ?time)$/],
  ['segment', /^(type|kind|segment|segment type|category|format)$/],
  ['who', /^(who|talent|presenter|speaker|host|owner|responsible|person|lead|on stage|performer)$/],
  ['input', /^(input|camera|cam|source|shot|video source|vision)$/],
  ['transition', /^(transition|trans|tx|effect)$/],
  ['overlay', /^(title or overlay|overlay|graphics?|gfx|lower ?third|l3|cg|chyron|title graphic)$/],
  ['notes', /^(notes?|comments?|remarks?|details|production notes|director notes)$/],
  ['script', /^(script|copy|words|text|prompter|teleprompter|read)$/],
  ['color', /^(colou?r)$/],
  ['skip', /^(float(ed)?|skip(ped)?|omit|cut|hidden)$/],
];

export function headerField(h: string): Field | null {
  const k = h
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[()]/g, '')
    .trim();
  for (const [f, re] of HEADER_WORDS) if (re.test(k)) return f;
  return null;
}

/** "Camera shot", "cam", "VID", "speaker" → a cue type ('custom' when unknown). */
export function segmentFrom(text: string): Segment {
  const k = text.trim().toLowerCase();
  if (!k) return 'custom';
  if (isSegment(k)) return k;
  const byName = SEGMENTS.find((s) => s.name.toLowerCase() === k || s.short.toLowerCase() === k);
  if (byName) return byName.id;
  if (/cam|shot|live/.test(k)) return 'camera';
  if (/vid|vt|clip|roll|playback/.test(k)) return 'video';
  if (/speak|talk|keynote|panel|host|\bmc\b|remarks/.test(k)) return 'speaker';
  if (/slide|deck|ppt|powerpoint/.test(k)) return 'slide';
  if (/lyric|song|music/.test(k)) return 'lyrics';
  if (/count/.test(k)) return 'countdown';
  if (/break|intermission|recess|lunch|pause/.test(k)) return 'break';
  if (/title|name|lower|gfx|graphic/.test(k)) return 'title';
  return 'custom';
}

export interface Imported {
  cues: Partial<PlanCue>[];
  /** Headers that matched nothing (they can become extra columns). */
  extra: string[];
  /** Header → what it was read as, for the person to check. */
  mapping: { header: string; field: Field | 'extra' | null }[];
  /** Rows with no cue name or length (skipped). */
  skipped: number;
}

/**
 * Cues from sheet rows. The first row is the header when it names known
 * columns; otherwise the columns are taken as Cue, Length, Who, Notes.
 * Unknown headers go to `extra` (and, with `columns`, into those extra columns).
 */
export function rowsToCues(rows: readonly (readonly string[])[], columns: readonly CustomColumn[] = []): Imported {
  if (!rows.length) return { cues: [], extra: [], mapping: [], skipped: 0 };
  const first = rows[0]!;
  const fields = first.map(headerField);
  const hasHeader = fields.filter(Boolean).length >= 1 && fields.some((f) => f === 'title' || f === 'length' || f === 'start' || f === 'who');
  const map: (Field | 'extra' | null)[] = hasHeader
    ? first.map((h, i) => {
        const f = fields[i] ?? null;
        // The same field twice: the first one wins; the rest are extra.
        if (f && fields.indexOf(f) !== i) return h.trim() ? 'extra' : null;
        return f ?? (h.trim() ? 'extra' : null);
      })
    : ['title', 'length', 'who', 'notes'];
  const extra = hasHeader ? first.filter((_, i) => map[i] === 'extra').map((h) => h.trim()) : [];
  const colByName = new Map(columns.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const body = hasHeader ? rows.slice(1) : rows;
  const cues: Partial<PlanCue>[] = [];
  /** Each cue's start as written (to work out lengths from the times when there are none). */
  const starts: (number | null)[] = [];
  let skipped = 0;
  let section = '';
  for (const r of body) {
    const get = (f: Field) => {
      const i = map.indexOf(f);
      return i >= 0 ? (r[i] ?? '').trim() : '';
    };
    const title = get('title');
    let len = parseDuration(get('length'));
    const start = parseClock(get('start'));
    const end = parseClock(get('end'));
    if (len === null && start !== null && end !== null && end > start) len = end - start;
    // A row with only a section name: a heading for the cues below.
    const sec = get('section');
    if (sec) section = sec.slice(0, 60);
    if (!title && len === null && !get('script') && !get('notes')) {
      if (!sec) skipped++;
      continue;
    }
    const custom: Record<string, string> = {};
    first.forEach((h, i) => {
      if (map[i] !== 'extra') return;
      const id = colByName.get(h.trim().toLowerCase());
      const v = (r[i] ?? '').trim();
      if (id && v) custom[id] = v.slice(0, 200);
    });
    const color = get('color').toLowerCase();
    const fixed = parseClock(get('fixed'));
    starts.push(start);
    cues.push({
      title: title.slice(0, 120),
      section,
      durationSec: len === null ? null : Math.min(len, 86_400),
      startTime: fixed !== null ? clock24(fixed) : '',
      segment: segmentFrom(get('segment')),
      who: get('who').slice(0, 80),
      input: get('input').slice(0, 80),
      transition: get('transition').slice(0, 40),
      overlay: get('overlay').slice(0, 80),
      notes: get('notes').slice(0, 4000),
      script: get('script').slice(0, 20_000),
      color: (['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'].includes(color) ? color : '') as PlanCue['color'],
      skip: /^(y|yes|true|x|1)$/i.test(get('skip')),
      custom,
    });
  }
  // Times but no lengths (a sheet of start times): each cue runs until the next one starts.
  if (!map.includes('length') && !map.includes('end')) {
    cues.forEach((c, i) => {
      const a = starts[i];
      const b = starts[i + 1];
      if (c.durationSec == null && a != null && b != null && b > a) c.durationSec = b - a;
    });
  }
  return { cues, extra, mapping: first.map((h, i) => ({ header: h, field: hasHeader ? map[i]! : null })), skipped };
}

// ---- Lists as sheets ----

export function itemsToCsv(kind: ItemKind, items: readonly Item[], cues: readonly PlanCue[] = []): string {
  const w = KIND_WORDS[kind];
  const cueName = (id: string | null) => {
    if (!id) return '';
    const i = cues.findIndex((c) => c.id === id);
    return i >= 0 ? `${i + 1}. ${cueLabel(cues[i]!)}` : '';
  };
  const time = (t: string) => {
    const s = parseClock(t);
    return s === null ? '' : clock12(s);
  };
  const money = (n: number | null) => (n === null ? '' : n.toFixed(2));
  let rows: string[][];
  if (kind === 'crew')
    rows = [
      ['Name', 'Position', 'Call day', 'Call time', 'Phone', 'Email', 'Notes'],
      ...items.map((i) => [i.title, i.role, i.day, time(i.callTime), i.phone, i.email, i.notes]),
    ];
  else if (kind === 'contact') rows = [['Name', w.role, 'Phone', 'Email', 'Notes'], ...items.map((i) => [i.title, i.role, i.phone, i.email, i.notes])];
  else if (kind === 'task')
    rows = [['Done', 'Task', 'For', 'Due', 'Cue', 'Notes'], ...items.map((i) => [i.done ? 'yes' : '', i.title, i.person, i.day, cueName(i.cueId), i.notes])];
  else if (kind === 'gear')
    rows = [
      ['Item', 'Qty', 'Department', 'Who brings it', 'Status', 'Notes'],
      ...items.map((i) => [i.title, i.qty === null ? '' : String(i.qty), i.role, i.person, i.status, i.notes]),
    ];
  else
    rows = [
      ['Line', 'Category', 'Vendor', 'Qty', 'Estimate', 'Actual', 'Status', 'Notes'],
      ...items.map((i) => [i.title, i.role, i.person, i.qty === null ? '' : String(i.qty), money(i.amount), money(i.actual), i.status, i.notes]),
    ];
  return toCsv(rows);
}

// ---- Excel (.xlsx) ----

const xml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML can't hold.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const colName = (n: number): string => {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A .zip of files, stored (not compressed): enough for an .xlsx. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true);
    c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** An Excel workbook with one sheet per table (header row bold and frozen). */
export function toXlsx(sheets: { name: string; rows: readonly (readonly string[])[] }[]): Uint8Array {
  const enc = new TextEncoder();
  const safeName = (n: string, i: number) =>
    n
      .replace(/[\\/?*[\]:]/g, ' ')
      .slice(0, 31)
      .trim() || `Sheet${i + 1}`;
  const sheetXml = (rows: readonly (readonly string[])[]) => {
    const widths = (rows[0] ?? []).map((_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 200).map((r) => (r[c] ?? '').split('\n')[0]!.length + 2))));
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '') +
      '<sheetData>' +
      rows
        .map(
          (r, ri) =>
            `<row r="${ri + 1}">` +
            r
              .map((v, ci) => {
                const ref = `${colName(ci)}${ri + 1}`;
                const style = ri === 0 ? ' s="1"' : '';
                if (ri > 0 && /^-?\d+(\.\d+)?$/.test(v) && v.length < 15 && !/^0\d/.test(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
                return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
              })
              .join('') +
            '</row>',
        )
        .join('') +
      '</sheetData></worksheet>'
    );
  };
  const names = sheets.map((s, i) => safeName(s.name, i));
  const files = [
    {
      name: '[Content_Types].xml',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'xl/styles.xml',
      text:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>' +
        '<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s.rows) })),
  ];
  return zipStore(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })));
}

/** The files in a .zip (stored or deflated; deflate needs DecompressionStream, which current browsers have). */
export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not an Excel file (.xlsx).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open Excel files. Save the sheet as CSV and import that.');
      const stream = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    }
  }
  return out;
}

/** The first sheet of an Excel file, as rows of text. */
export async function readXlsx(buf: Uint8Array): Promise<string[][]> {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const parse = (name: string) => {
    const f = files.get(name);
    return f ? new DOMParser().parseFromString(dec.decode(f), 'application/xml') : null;
  };
  const shared: string[] = [];
  const ss = parse('xl/sharedStrings.xml');
  if (ss)
    for (const si of Array.from(ss.getElementsByTagName('si')))
      shared.push(
        Array.from(si.getElementsByTagName('t'))
          .map((t) => t.textContent ?? '')
          .join(''),
      );
  // The first sheet in the workbook's order.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = parse('xl/workbook.xml');
  const rels = parse('xl/_rels/workbook.xml.rels');
  const first = wb?.getElementsByTagName('sheet')[0];
  const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (rid && rels) {
    const rel = Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = parse(sheetPath);
  if (!sheet) throw new Error('This Excel file has no sheet to read.');
  const rows: string[][] = [];
  for (const r of Array.from(sheet.getElementsByTagName('row'))) {
    const row: string[] = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r') ?? '';
      const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
      let col = 0;
      for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
      col = letters ? col - 1 : row.length;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let text = '';
      if (t === 's') text = shared[Number(v)] ?? '';
      else if (t === 'inlineStr')
        text = Array.from(c.getElementsByTagName('t'))
          .map((x) => x.textContent ?? '')
          .join('');
      else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else text = excelNumber(v, c.getAttribute('s'));
      while (row.length < col) row.push('');
      row[col] = text;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Numbers as Excel stores them: times of day and lengths are fractions of a day ("0.0034722" is 5:00). */
function excelNumber(v: string, style: string | null): string {
  const n = Number(v);
  if (!v || !Number.isFinite(n)) return v;
  // Without the style table, a fraction under 1 with a style is most likely a time.
  if (style && n > 0 && n < 1 && !Number.isInteger(n)) {
    const secs = Math.round(n * 86_400);
    return `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }
  return String(Math.round(n * 1e6) / 1e6);
}

// ---- Calendar (.ics) ----

const icsText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets folded, as calendars expect. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 73) {
      out.push(cur);
      cur = ' ' + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

const stamp = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const ymd = (d: string): string => d.replace(/-/g, '');
const hms = (secs: number): string => {
  const s = ((secs % 86_400) + 86_400) % 86_400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}${String(s % 60).padStart(2, '0')}`;
};
const addDays = (d: string, n: number): string => {
  const [y, m, day] = d.split('-').map(Number);
  const x = new Date(Date.UTC(y!, m! - 1, day! + n));
  return x.toISOString().slice(0, 10);
};

/** A calendar file with the event (start to planned end) and its schedule blocks. */
export function planToIcs(plan: Plan, cues: readonly PlanCue[], blocks: readonly Block[], now = new Date()): string {
  const tz = plan.timeZone;
  const when = (date: string, secs: number) => {
    const extra = Math.floor(secs / 86_400);
    const d = extra ? addDays(date, extra) : date;
    return `${tz ? `;TZID=${tz}` : ''}:${ymd(d)}T${hms(secs)}`;
  };
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lumora//Planner//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(plan.name || 'Lumora Planner')}`,
  ];
  if (plan.eventDate) {
    const s = schedule(cues, plan.startTime);
    const start = parseClock(plan.startTime);
    lines.push('BEGIN:VEVENT', `UID:plan-${plan.id}@lumora-planner`, `DTSTAMP:${stamp(now)}`);
    if (start !== null) {
      lines.push(`DTSTART${when(plan.eventDate, start)}`);
      lines.push(`DTEND${when(plan.eventDate, s.endSec !== null && s.endSec > start ? s.endSec : start + Math.max(1800, s.totalSec))}`);
    } else lines.push(`DTSTART;VALUE=DATE:${ymd(plan.eventDate)}`);
    lines.push(`SUMMARY:${icsText(plan.name || 'Untitled plan')}`);
    if (plan.venue) lines.push(`LOCATION:${icsText(plan.venue)}`);
    const agenda = sortCues(cues)
      .filter((c) => !c.skip)
      .map((c, i) => `${s.rows[i]?.start != null ? clock12(s.rows[i]!.start!) + ' ' : ''}${cueLabel(c)}`)
      .slice(0, 60)
      .join('\n');
    if (agenda || plan.notes) lines.push(`DESCRIPTION:${icsText([agenda, plan.notes].filter(Boolean).join('\n\n'))}`);
    lines.push('END:VEVENT');
  }
  for (const b of blocks) {
    if (!b.day) continue;
    const st = parseClock(b.starts);
    const en = parseClock(b.ends);
    lines.push('BEGIN:VEVENT', `UID:block-${b.id}@lumora-planner`, `DTSTAMP:${stamp(now)}`);
    if (st !== null) {
      lines.push(`DTSTART${when(b.day, st)}`);
      if (en !== null && en > st) lines.push(`DTEND${when(b.day, en)}`);
    } else lines.push(`DTSTART;VALUE=DATE:${ymd(b.day)}`);
    lines.push(`SUMMARY:${icsText(`${b.title || 'Untitled block'} · ${plan.name || 'Untitled plan'}`)}`);
    if (b.location) lines.push(`LOCATION:${icsText(b.location)}`);
    if (b.who || b.notes) lines.push(`DESCRIPTION:${icsText([b.who && `Who: ${b.who}`, b.notes].filter(Boolean).join('\n'))}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---- Saving a file ----

/** Hand the person a file to save. */
export function downloadBytes(name: string, data: Uint8Array | string, type: string): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, '-');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const downloadText = (name: string, text: string, type: string): void => downloadBytes(name, text, `${type};charset=utf-8`);
