// Type layers in PSD files: the TySh block's "EngineData" (a PostScript-like
// text description of the words, fonts, sizes, colors and paragraphs) read
// into our text model and written from it.

import type { TextModel, TextRun, CharStyle } from '../text';
import { defaultChar, defaultPara } from '../text';

type EVal = number | boolean | string | EVal[] | { [k: string]: EVal } | null;

// ---- parsing ----

export function parseEngineData(bytes: Uint8Array): Record<string, EVal> {
  let i = 0;
  const n = bytes.length;
  const ws = () => {
    while (i < n && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x00)) i++;
  };
  const value = (): EVal => {
    ws();
    const c = bytes[i];
    if (c === 0x3c && bytes[i + 1] === 0x3c) {
      i += 2;
      const obj: Record<string, EVal> = {};
      for (;;) {
        ws();
        if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
          i += 2;
          return obj;
        }
        if (i >= n) return obj;
        if (bytes[i] !== 0x2f) {
          i++;
          continue;
        }
        i++;
        let key = '';
        while (i < n && !/[\s/<>[\]()]/.test(String.fromCharCode(bytes[i]!))) key += String.fromCharCode(bytes[i++]!);
        obj[key] = value();
      }
    }
    if (c === 0x5b) {
      i++;
      const arr: EVal[] = [];
      for (;;) {
        ws();
        if (bytes[i] === 0x5d) {
          i++;
          return arr;
        }
        if (i >= n) return arr;
        arr.push(value());
      }
    }
    if (c === 0x28) {
      // A string: UTF-16BE with a BOM, backslash escapes.
      i++;
      const raw: number[] = [];
      while (i < n && bytes[i] !== 0x29) {
        if (bytes[i] === 0x5c) {
          i++;
          const e = bytes[i]!;
          raw.push(e === 0x6e ? 10 : e === 0x72 ? 13 : e === 0x74 ? 9 : e);
          i++;
          continue;
        }
        raw.push(bytes[i++]!);
      }
      i++;
      if (raw[0] === 0xfe && raw[1] === 0xff) {
        let s = '';
        for (let k = 2; k + 1 < raw.length; k += 2) s += String.fromCharCode((raw[k]! << 8) | raw[k + 1]!);
        return s;
      }
      return String.fromCharCode(...raw);
    }
    if (c === 0x2f) {
      i++;
      let s = '';
      while (i < n && !/[\s/<>[\]()]/.test(String.fromCharCode(bytes[i]!))) s += String.fromCharCode(bytes[i++]!);
      return s;
    }
    let tok = '';
    while (i < n && !/[\s/<>[\]()]/.test(String.fromCharCode(bytes[i]!))) tok += String.fromCharCode(bytes[i++]!);
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    const v = parseFloat(tok);
    return Number.isFinite(v) ? v : tok || null;
  };
  const top = value();
  return (top && typeof top === 'object' && !Array.isArray(top) ? top : {}) as Record<string, EVal>;
}

const at = (o: EVal | undefined, ...path: (string | number)[]): EVal | undefined => {
  let cur: EVal | undefined = o;
  for (const p of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof p === 'number') cur = Array.isArray(cur) ? cur[p] : undefined;
    else cur = typeof cur === 'object' && !Array.isArray(cur) ? (cur as Record<string, EVal>)[p] : undefined;
  }
  return cur;
};

/** Font names from PostScript names ("Inter-SemiBold" → family, weight, italic). */
export function fontFromPostScript(ps: string): { family: string; weight: number; italic: boolean } {
  const [famRaw, style = 'Regular'] = ps.split('-');
  const s = style.toLowerCase();
  const weight = /thin|hairline/.test(s)
    ? 100
    : /extralight|ultralight/.test(s)
      ? 200
      : /light/.test(s)
        ? 300
        : /medium/.test(s)
          ? 500
          : /semibold|demibold/.test(s)
            ? 600
            : /extrabold|ultrabold/.test(s)
              ? 800
              : /black|heavy/.test(s)
                ? 900
                : /bold/.test(s)
                  ? 700
                  : 400;
  const family = (famRaw ?? ps).replace(/MT$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return { family, weight, italic: /italic|oblique/.test(s) };
}

export function postScriptName(s: CharStyle): string {
  const fam = s.family.replace(/\s+Variable$/, '').replace(/\s+/g, '');
  const w = s.weight;
  const style =
    (w <= 100
      ? 'Thin'
      : w <= 200
        ? 'ExtraLight'
        : w <= 300
          ? 'Light'
          : w <= 400
            ? 'Regular'
            : w <= 500
              ? 'Medium'
              : w <= 600
                ? 'SemiBold'
                : w <= 700
                  ? 'Bold'
                  : w <= 800
                    ? 'ExtraBold'
                    : 'Black') + (s.italic ? 'Italic' : '');
  return `${fam}-${style === 'RegularItalic' ? 'Italic' : style}`;
}

/** The text model from a TySh's EngineData, the layer's transform (xx, xy, yx, yy, tx, ty) and box bounds. */
export function textFromEngine(engine: Uint8Array, tr: number[], box: { left: number; top: number; right: number; bottom: number } | null): TextModel | null {
  const ed = parseEngineData(engine);
  const text = at(ed, 'EngineDict', 'Editor', 'Text');
  if (typeof text !== 'string') return null;
  const fonts = (at(ed, 'ResourceDict', 'FontSet') as EVal[] | undefined) ?? (at(ed, 'DocumentResources', 'FontSet') as EVal[] | undefined) ?? [];
  const runArray = (at(ed, 'EngineDict', 'StyleRun', 'RunArray') as EVal[] | undefined) ?? [];
  const lengths = (at(ed, 'EngineDict', 'StyleRun', 'RunLengthArray') as number[] | undefined) ?? [text.length];
  const scale = Math.hypot(tr[0] ?? 1, tr[1] ?? 0) || 1;
  const styleOf = (r: EVal): Partial<CharStyle> => {
    const sd = at(r, 'StyleSheet', 'StyleSheetData') as Record<string, EVal> | undefined;
    if (!sd) return {};
    const out: Partial<CharStyle> = {};
    if (typeof sd.FontSize === 'number') out.size = sd.FontSize * scale;
    if (typeof sd.Font === 'number') {
      const fname = at(fonts[sd.Font], 'Name');
      if (typeof fname === 'string') Object.assign(out, fontFromPostScript(fname));
    }
    const fc = at(sd, 'FillColor', 'Values') as number[] | undefined;
    if (Array.isArray(fc) && fc.length >= 4) out.color = [fc[1]!, fc[2]!, fc[3]!];
    if (typeof sd.Tracking === 'number') out.tracking = sd.Tracking;
    if (typeof sd.Leading === 'number' && sd.AutoLeading === false) out.leading = sd.Leading * scale;
    if (typeof sd.BaselineShift === 'number') out.baselineShift = sd.BaselineShift * scale;
    if (sd.FauxBold === true) out.fauxBold = true;
    if (sd.FauxItalic === true) out.fauxItalic = true;
    if (sd.Underline === true) out.underline = true;
    if (sd.Strikethrough === true) out.strike = true;
    if (typeof sd.FontCaps === 'number') out.caps = sd.FontCaps === 2 ? 'all' : sd.FontCaps === 1 ? 'small' : 'normal';
    if (typeof sd.HorizontalScale === 'number') out.hScale = sd.HorizontalScale * 100;
    if (typeof sd.VerticalScale === 'number') out.vScale = sd.VerticalScale * 100;
    if (sd.Ligatures === false) out.ligatures = false;
    if (typeof sd.AutoKerning === 'boolean') out.kerning = sd.AutoKerning;
    return out;
  };
  // Photoshop ends the text with a carriage return; paragraphs are \r.
  const clean = text.replace(/\r/g, '\n').replace(/\n$/, '');
  const runs: TextRun[] = [];
  let pos = 0;
  runArray.forEach((r, k) => {
    const len = lengths[k] ?? 0;
    const piece = clean.slice(pos, pos + len);
    pos += len;
    if (piece) runs.push({ text: piece, style: styleOf(r) });
  });
  if (pos < clean.length) runs.push({ text: clean.slice(pos) });
  const base = { ...defaultChar(), ...(runs[0]?.style ?? {}) };
  const just = at(ed, 'EngineDict', 'ParagraphRun', 'RunArray', 0, 'ParagraphSheet', 'Properties', 'Justification');
  const align = just === 1 ? 'right' : just === 2 ? 'center' : just === 3 || just === 4 || just === 5 || just === 6 ? 'justify' : 'left';
  const rotation = (Math.atan2(tr[1] ?? 0, tr[0] ?? 1) * 180) / Math.PI;
  const model: TextModel = {
    runs: runs.length ? runs : [{ text: clean }],
    base,
    para: { ...defaultPara(), align },
    mode: box ? 'box' : 'point',
    x: tr[4] ?? 0,
    y: tr[5] ?? 0,
    rotation,
    antialias: 'smooth',
  };
  if (box) {
    model.x = (tr[4] ?? 0) + box.left * scale;
    model.y = (tr[5] ?? 0) + box.top * scale;
    model.box = { w: (box.right - box.left) * scale, h: (box.bottom - box.top) * scale };
  }
  return model;
}

// ---- writing ----

function str(s: string): string {
  let out = '(þÿ';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    const hi = c >> 8,
      lo = c & 255;
    for (const b of [hi, lo]) {
      const chr = String.fromCharCode(b);
      out += b === 0x28 || b === 0x29 || b === 0x5c ? `\\${chr}` : chr;
    }
  }
  return `${out})`;
}

const num = (v: number) => (Number.isInteger(v) ? `${v}` : v.toFixed(5).replace(/0+$/, '').replace(/^0\./, '.').replace(/^-0\./, '-.'));

function styleSheet(s: CharStyle, fontIndex: number): string {
  return `<< /Font ${fontIndex} /FontSize ${num(s.size)} /FauxBold ${s.fauxBold} /FauxItalic ${s.fauxItalic} /AutoLeading ${s.leading <= 0} /Leading ${num(s.leading > 0 ? s.leading : s.size * 1.2)} /HorizontalScale ${num(s.hScale / 100)} /VerticalScale ${num(s.vScale / 100)} /Tracking ${Math.round(s.tracking)} /AutoKerning ${s.kerning} /Kerning 0 /BaselineShift ${num(s.baselineShift)} /FontCaps ${s.caps === 'all' ? 2 : s.caps === 'small' ? 1 : 0} /Underline ${s.underline} /Strikethrough ${s.strike} /Ligatures ${s.ligatures} /FillColor << /Type 1 /Values [ 1.0 ${num(s.color[0])} ${num(s.color[1])} ${num(s.color[2])} ] >> >>`;
}

/** EngineData for a text model (sizes in the layer's own units: the transform carries no scale). */
export function engineData(t: TextModel): Uint8Array {
  const text =
    t.runs
      .map((r) => r.text)
      .join('')
      .replace(/\n/g, '\r') + '\r';
  const styles = t.runs.map((r) => ({ ...t.base, ...r.style }));
  const fontNames: string[] = [];
  const fontIdx = (s: CharStyle) => {
    const n = postScriptName(s);
    let k = fontNames.indexOf(n);
    if (k < 0) {
      fontNames.push(n);
      k = fontNames.length - 1;
    }
    return k;
  };
  const runSheets = styles.map((s) => `<< /StyleSheet << /StyleSheetData ${styleSheet(s, fontIdx(s))} >> >>`);
  const runLens = t.runs.map((r, i) => r.text.replace(/\n/g, '\r').length + (i === t.runs.length - 1 ? 1 : 0));
  const just = t.para.align === 'right' ? 1 : t.para.align === 'center' ? 2 : t.para.align === 'justify' ? 3 : 0;
  const para = `<< /ParagraphSheet << /DefaultStyleSheet 0 /Properties << /Justification ${just} /FirstLineIndent ${num(t.para.indentFirst)} /StartIndent ${num(t.para.indentLeft)} /EndIndent ${num(t.para.indentRight)} /SpaceBefore ${num(t.para.spaceBefore)} /SpaceAfter ${num(t.para.spaceAfter)} >> >> /Adjustments << /Axis [ 1.0 0.0 1.0 ] /XY [ 0.0 0.0 ] >> >>`;
  const box = t.mode === 'box' && t.box;
  const shapeType = box ? 1 : 0;
  const base = box
    ? `/Base << /ShapeType 1 /TransformPoint0 [ 1.0 0.0 ] /TransformPoint1 [ 0.0 1.0 ] /TransformPoint2 [ 0.0 0.0 ] >> /BoxBounds [ 0.0 0.0 ${num(t.box!.w)} ${num(t.box!.h)} ]`
    : `/Base << /ShapeType 0 /TransformPoint0 [ 1.0 0.0 ] /TransformPoint1 [ 0.0 1.0 ] /TransformPoint2 [ 0.0 0.0 ] >>`;
  const fontSet = fontNames.map((n) => `<< /Name ${str(n)} /Script 0 /FontType 1 /Synthetic 0 >>`).join(' ');
  const res = `<< /KinsokuSet [ ] /MojiKumiSet [ ] /TheNormalStyleSheet 0 /TheNormalParagraphSheet 0 /ParagraphSheetSet [ << /Name ${str('Normal RGB')} /DefaultStyleSheet 0 /Properties << /Justification 0 >> >> ] /StyleSheetSet [ << /Name ${str('Normal RGB')} /StyleSheetData ${styleSheet(t.base, fontIdx(t.base))} >> ] /FontSet [ ${fontNames.map((n) => `<< /Name ${str(n)} /Script 0 /FontType 1 /Synthetic 0 >>`).join(' ')} ] /SuperscriptSize .583 /SuperscriptPosition .333 /SubscriptSize .583 /SubscriptPosition .333 /SmallCapSize .7 >>`;
  void fontSet;
  const s = `\n\n<<\n\t/EngineDict\n\t<<\n\t\t/Editor << /Text ${str(text)} >>\n\t\t/ParagraphRun << /DefaultRunData ${para} /RunArray [ ${para} ] /RunLengthArray [ ${text.length} ] /IsJoinable 1 >>\n\t\t/StyleRun << /DefaultRunData << /StyleSheet << /StyleSheetData << >> >> >> /RunArray [ ${runSheets.join(' ')} ] /RunLengthArray [ ${runLens.join(' ')} ] /IsJoinable 2 >>\n\t\t/GridInfo << /GridIsOn false /ShowGrid false /GridSize 18.0 /GridLeading 22.0 /GridColor << /Type 1 /Values [ 0.0 0.0 0.0 1.0 ] >> /GridLeadingFillColor << /Type 1 /Values [ 0.0 0.0 0.0 1.0 ] >> /AlignLineHeightToGridFlags false >>\n\t\t/AntiAlias ${t.antialias === 'none' ? 0 : t.antialias === 'sharp' ? 1 : 4}\n\t\t/UseFractionalGlyphWidths true\n\t\t/Rendered << /Version 1 /Shapes << /WritingDirection 0 /Children [ << /ShapeType ${shapeType} /Procession 0 /Lines << /WritingDirection 0 /Children [ ] >> /Cookie << /Photoshop << /ShapeType ${shapeType} ${box ? '' : '/PointBase [ 0.0 0.0 ] '}${base} >> >> >> ] >> >>\n\t>>\n\t/ResourceDict ${res}\n\t/DocumentResources ${res}\n>>`;
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}
