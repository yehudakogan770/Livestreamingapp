// Final Cut Pro 7 XML (xmeml, .xml): what Premiere Pro calls “Final Cut Pro
// XML” and DaVinci Resolve imports and exports as “FCP 7 XML”. Times are whole
// frames at the sequence's timebase (with NTSC set for 29.97 and the like).
import {
  dropFrameRate,
  fileNameOf,
  fileUrl,
  kid,
  kids,
  kidText,
  parseXml,
  pathFromUrl,
  standardFps,
  timelineLength,
  xmlEscape,
  type XClip,
  type XFile,
  type XMarker,
  type XTimeline,
  type XTrack,
} from './timeline';

const ntsc = (fps: number) => Math.abs(fps - Math.round(fps)) > 0.001;
const rateXml = (fps: number, pad: string) => `${pad}<rate><timebase>${Math.round(fps)}</timebase><ntsc>${ntsc(fps) ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
const exactOf = (fps: number) => (ntsc(fps) ? (Math.round(fps) * 1000) / 1001 : fps);

/** Write a timeline as FCP7 XML (version 4, which Premiere and Resolve both read). */
export function writeXmeml(t: XTimeline): string {
  const fps = t.fps;
  const exact = exactOf(fps);
  const total = timelineLength(t);
  const fileIds = new Map<string, string>();
  const written = new Set<string>();
  let clipN = 0;
  let masterN = 0;
  const masters = new Map<string, string>();

  const fileXml = (f: XFile, pad: string): string[] => {
    const key = f.name.toLowerCase();
    let id = fileIds.get(key);
    if (!id) {
      id = `file-${fileIds.size + 1}`;
      fileIds.set(key, id);
    }
    if (written.has(id)) return [`${pad}<file id="${id}"/>`];
    written.add(id);
    const frames = Math.round(f.duration * exact);
    return [
      `${pad}<file id="${id}">`,
      `${pad}  <name>${xmlEscape(f.name)}</name>`,
      `${pad}  <pathurl>${xmlEscape(fileUrl(f.path, true))}</pathurl>`,
      rateXml(f.fps || fps, `${pad}  `),
      `${pad}  <duration>${frames}</duration>`,
      `${pad}  <media>`,
      ...(f.hasVideo
        ? [
            `${pad}    <video><samplecharacteristics>${rateXml(f.fps || fps, '')}<width>${f.width || t.width}</width><height>${f.height || t.height}</height></samplecharacteristics></video>`,
          ]
        : []),
      ...(f.hasAudio
        ? [
            `${pad}    <audio><samplecharacteristics><depth>24</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>`,
          ]
        : []),
      `${pad}  </media>`,
      `${pad}</file>`,
    ];
  };

  const trackXml = (tr: XTrack, index: number): string[] => {
    const out = ['        <track>'];
    const clips = tr.clips.filter((c) => c.file).sort((a, b) => a.start - b.start);
    // Dissolves need the clip before to end where this one starts.
    const joined = new Set<XClip>();
    clips.forEach((c, i) => {
      const prev = clips[i - 1];
      if (tr.kind === 'video' && c.dissolveIn && prev && prev.start + prev.length === c.start) joined.add(c);
    });
    clips.forEach((c, i) => {
      const f = c.file as XFile;
      const speed = Math.abs(c.speed || 1);
      const inF = Math.round(c.srcIn * exact);
      const outF = inF + Math.round(c.length * speed);
      const next = clips[i + 1];
      const startsInDissolve = joined.has(c);
      const endsInDissolve = !!next && joined.has(next);
      if (startsInDissolve) {
        const d = Math.round(c.dissolveIn ?? 0);
        const h = Math.floor(d / 2);
        out.push(
          '          <transitionitem>',
          `            <start>${c.start - h}</start>`,
          `            <end>${c.start - h + d}</end>`,
          '            <alignment>center</alignment>',
          rateXml(fps, '            '),
          '            <effect><name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype></effect>',
          '          </transitionitem>',
        );
      }
      clipN += 1;
      const key = f.name.toLowerCase();
      if (!masters.has(key)) masters.set(key, `masterclip-${++masterN}`);
      const filters: string[] = [];
      if (speed !== 1 || c.reverse)
        filters.push(
          '            <filter><effect><name>Time Remap</name><effectid>timeremap</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>',
          '              <parameter><parameterid>variablespeed</parameterid><name>variablespeed</name><value>0</value></parameter>',
          `              <parameter><parameterid>speed</parameterid><name>speed</name><value>${Math.round(speed * 10000) / 100}</value></parameter>`,
          `              <parameter><parameterid>reverse</parameterid><name>reverse</name><value>${c.reverse ? 'TRUE' : 'FALSE'}</value></parameter>`,
          '            </effect></filter>',
        );
      if (tr.kind === 'audio' && c.gain !== undefined)
        filters.push(
          '            <filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>',
          `              <parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${Math.round(10 ** (c.gain / 20) * 100000) / 100000}</value></parameter>`,
          '            </effect></filter>',
        );
      out.push(
        `          <clipitem id="clipitem-${clipN}">`,
        `            <masterclipid>${masters.get(key)}</masterclipid>`,
        `            <name>${xmlEscape(c.name)}</name>`,
        `            <enabled>${c.enabled ? 'TRUE' : 'FALSE'}</enabled>`,
        `            <duration>${Math.max(outF, Math.round(f.duration * exact))}</duration>`,
        rateXml(fps, '            '),
        `            <start>${startsInDissolve ? -1 : c.start}</start>`,
        `            <end>${endsInDissolve ? -1 : c.start + c.length}</end>`,
        `            <in>${inF}</in>`,
        `            <out>${outF}</out>`,
        ...fileXml(f, '            '),
        ...(tr.kind === 'audio'
          ? [`            <sourcetrack><mediatype>audio</mediatype><trackindex>${index % 2 === 0 ? 1 : 2}</trackindex></sourcetrack>`]
          : []),
        ...filters,
        '          </clipitem>',
      );
    });
    out.push(`          <enabled>TRUE</enabled>`, `          <locked>FALSE</locked>`, '        </track>');
    return out;
  };

  const video = t.tracks.filter((x) => x.kind === 'video');
  const audio = t.tracks.filter((x) => x.kind === 'audio');
  const markers = t.markers.map((m) => [
    '    <marker>',
    `      <name>${xmlEscape(m.name)}</name>`,
    '      <comment></comment>',
    `      <in>${m.at}</in>`,
    `      <out>${m.length > 0 ? m.at + m.length : -1}</out>`,
    '    </marker>',
  ]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="4">',
    '  <sequence id="sequence-1">',
    `    <name>${xmlEscape(t.name)}</name>`,
    `    <duration>${total}</duration>`,
    rateXml(fps, '    '),
    `    <timecode>${rateXml(fps, '')}<string>${dropFrameRate(fps) ? '00;00;00;00' : '00:00:00:00'}</string><frame>0</frame><displayformat>${dropFrameRate(fps) ? 'DF' : 'NDF'}</displayformat></timecode>`,
    '    <media>',
    '      <video>',
    `        <format><samplecharacteristics>${rateXml(fps, '')}<width>${t.width}</width><height>${t.height}</height><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>`,
    ...video.flatMap((tr, i) => trackXml(tr, i)),
    '      </video>',
    '      <audio>',
    '        <numOutputChannels>2</numOutputChannels>',
    ...audio.flatMap((tr, i) => trackXml(tr, i)),
    '      </audio>',
    '    </media>',
    ...markers.flat(),
    '  </sequence>',
    '</xmeml>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- reading

function rateOf(el: Element | null, fallback: number): number {
  const r = kid(el, 'rate');
  const tb = Number(kidText(r, 'timebase'));
  if (!tb) return fallback;
  return /TRUE/i.test(kidText(r, 'ntsc')) ? standardFps((tb * 1000) / 1001) : tb;
}

/** Read an FCP7 XML file (from Premiere Pro, DaVinci Resolve, Final Cut Pro 7, Avid…). */
export function readXmeml(text: string): XTimeline {
  const doc = parseXml(text);
  const root = doc.documentElement;
  if (root.tagName !== 'xmeml') throw new Error('This is not a Final Cut Pro 7 / Premiere XML file.');
  const seq = root.getElementsByTagName('sequence')[0];
  if (!seq) throw new Error('There is no sequence in this XML file.');
  const fps = rateOf(seq, 30);
  const exact = exactOf(fps);
  const media = kid(seq, 'media');
  const vfmt = kid(kid(kid(media, 'video'), 'format'), 'samplecharacteristics');
  const width = Number(kidText(vfmt, 'width')) || 1920;
  const height = Number(kidText(vfmt, 'height')) || 1080;
  const notes = new Map<string, number>();
  const note = (what: string) => notes.set(what, (notes.get(what) ?? 0) + 1);

  // Files are written in full once, then referred to by id.
  const files = new Map<string, XFile>();
  for (const f of Array.from(root.getElementsByTagName('file'))) {
    const id = f.getAttribute('id') ?? '';
    if (!id || files.has(id) || !f.children.length) continue;
    const url = kidText(f, 'pathurl');
    const path = url ? pathFromUrl(url) : kidText(f, 'name');
    const fr = rateOf(f, fps);
    const fm = kid(f, 'media');
    const vs = kid(kid(fm, 'video'), 'samplecharacteristics');
    files.set(id, {
      name: fileNameOf(path) || kidText(f, 'name'),
      path,
      duration: (Number(kidText(f, 'duration')) || 0) / exactOf(fr),
      width: Number(kidText(vs, 'width')) || 0,
      height: Number(kidText(vs, 'height')) || 0,
      fps: fr,
      hasVideo: !!kid(fm, 'video') || !fm,
      hasAudio: !!kid(fm, 'audio') || !fm,
    });
  }

  const readTrack = (track: Element, kind: 'video' | 'audio', name: string): XTrack => {
    const clips: XClip[] = [];
    const items = kids(track, 'clipitem', 'transitionitem', 'generatoritem');
    /** Where a transition puts its cut (frames). */
    const cutOf = (tr: Element): number => {
      const s = Number(kidText(tr, 'start'));
      const e = Number(kidText(tr, 'end'));
      const align = kidText(tr, 'alignment').toLowerCase();
      return align.startsWith('start') ? s : align.startsWith('end') ? e : Math.floor((s + e) / 2);
    };
    items.forEach((it, i) => {
      if (it.tagName === 'transitionitem') return;
      if (it.tagName === 'generatoritem') {
        note('generator (left as a gap)');
        return;
      }
      const fileEl = kid(it, 'file');
      const file = fileEl ? files.get(fileEl.getAttribute('id') ?? '') : undefined;
      if (!file) {
        note(kid(it, 'sequence') ? 'nested sequence (left as a gap)' : 'clip without a file (left as a gap)');
        return;
      }
      const prev = items[i - 1];
      const nextEl = items[i + 1];
      let start = Number(kidText(it, 'start'));
      let endF = Number(kidText(it, 'end'));
      let dissolveIn: number | undefined;
      if (start < 0 && prev?.tagName === 'transitionitem') {
        start = cutOf(prev);
        dissolveIn = Number(kidText(prev, 'end')) - Number(kidText(prev, 'start'));
      }
      if (endF < 0 && nextEl?.tagName === 'transitionitem') endF = cutOf(nextEl);
      if (!(endF > start)) return;
      const clipRate = exactOf(rateOf(it, fps));
      const inF = Number(kidText(it, 'in'));
      const outF = Number(kidText(it, 'out'));
      let speed = (outF - inF) / (endF - start) || 1;
      let reverse = false;
      for (const eff of Array.from(it.getElementsByTagName('effect'))) {
        if (kidText(eff, 'effectid') !== 'timeremap') continue;
        for (const p of kids(eff, 'parameter')) {
          const pid = kidText(p, 'parameterid');
          if (pid === 'speed') speed = Math.abs(Number(kidText(p, 'value')) / 100) || speed;
          if (pid === 'reverse') reverse = /TRUE/i.test(kidText(p, 'value'));
          if (pid === 'variablespeed' && kidText(p, 'value') === '1') note('speed ramp (read as one speed)');
        }
      }
      let gain: number | undefined;
      for (const eff of Array.from(it.getElementsByTagName('effect'))) {
        if (kidText(eff, 'effectid') !== 'audiolevels') continue;
        const lvl = kids(eff, 'parameter').find((p) => kidText(p, 'parameterid') === 'level');
        const v = Number(kidText(lvl, 'value'));
        if (v > 0 && Math.abs(v - 1) > 1e-4) gain = Math.round(20 * Math.log10(v) * 100) / 100;
      }
      clips.push({
        name: kidText(it, 'name') || file.name.replace(/\.[^.]+$/, ''),
        file,
        start,
        length: endF - start,
        srcIn: Math.max(0, Math.min(inF, outF)) / clipRate,
        speed,
        reverse,
        enabled: !/FALSE/i.test(kidText(it, 'enabled')),
        ...(dissolveIn && kind === 'video' ? { dissolveIn } : {}),
        ...(gain !== undefined ? { gain } : {}),
      });
    });
    return { kind, name, clips };
  };

  const tracks: XTrack[] = [];
  kids(kid(media, 'video') ?? seq, 'track').forEach((tr, i) => tracks.push(readTrack(tr, 'video', `V${i + 1}`)));
  kids(kid(media, 'audio') ?? seq, 'track').forEach((tr, i) => tracks.push(readTrack(tr, 'audio', `A${i + 1}`)));
  const markers: XMarker[] = kids(seq, 'marker').map((m) => {
    const at = Number(kidText(m, 'in'));
    const out = Number(kidText(m, 'out'));
    return { at, length: out > at ? out - at : 0, name: kidText(m, 'name') || kidText(m, 'comment') };
  });
  return {
    name: kidText(seq, 'name') || 'Imported timeline',
    width,
    height,
    fps,
    tracks,
    markers,
    notes: [...notes].map(([what, n]) => `${n} × ${what}`),
  };
}
